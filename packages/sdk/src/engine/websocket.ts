import {
	ConnectionUnavailable,
	EngineDisconnected,
	ReconnectExhaustion,
	UnexpectedConnectionError,
	UnexpectedServerResponse,
} from "../errors";

import type {
	ConnectionState,
	DriverContext,
	EngineEvents,
	SurrealEngine,
} from "../types/surreal";

import { getIncrementalID } from "../internal/get-incremental-id";
import { postEndpoint } from "../internal/http";
import { Publisher } from "../internal/publisher";
import type { ExportOptions } from "../types/export";
import { isLiveResult } from "../types/live";
import type { RpcRequest, RpcResponse } from "../types/rpc";
import type { Subscribe } from "../types";

type Interval = Parameters<typeof clearInterval>[0];
type Response = Record<string, unknown>;

interface Call<T> {
	request: object;
	resolve: (value: RpcResponse<T>) => void;
	reject: (error: Error) => void;
}

/**
 * An engine that communicates over WebSocket protocol
 */
export class WebSocketEngine implements SurrealEngine {
	#publisher = new Publisher<EngineEvents>();
	#state: ConnectionState | undefined;
	#socket: WebSocket | undefined;
	#calls = new Map<string, Call<unknown>>();
	#context: DriverContext;
	#pinger: Interval;
	#active = false;
	#terminated = false;

	subscribe: Subscribe<EngineEvents> = this.#publisher.subscribe;

	constructor(context: DriverContext) {
		this.#context = context;
	}

	open(state: ConnectionState): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			if (!this.#state) {
				reject(new ConnectionUnavailable());
				return;
			}

			this.#publisher.publish("connecting");
			this.#terminated = false;
			this.#state = state;

			const { reconnect } = state;

			(async () => {
				while (true) {
					const error = await this.createSocket(() => {
						this.#active = true;
						this.#publisher.publish("connected");
						reconnect.reset();

						for (const { request } of this.#calls.values()) {
							this.#socket?.send(this.#context.encode(request));
						}

						resolve();
					});

					this.#socket = undefined;

					// Check if we should continue to iterate and reconnect
					if (this.#terminated || !reconnect.enabled || !reconnect.allowed) {
						// Propagate reconnect exhaustion
						if (reconnect.enabled && !reconnect.allowed) {
							this.#publisher.publish("error", new ReconnectExhaustion());
						}

						// Optionally terminate pending calls
						if (!this.#terminated) {
							for (const { reject } of this.#calls.values()) {
								reject(new EngineDisconnected());
							}
						}

						this.#publisher.publish("disconnected");
						this.#state = undefined;
						this.#active = false;
						this.#calls.clear();

						reject(error);
						break;
					}

					// Propagate caught errors
					if (error) {
						reconnect.propagate(error);
					}

					this.#publisher.publish("reconnecting");

					// Perform a reconnect iteration cooldown
					await reconnect.iterate();
				}
			})();
		});
	}

	async close(): Promise<void> {
		this.#state = undefined;
		this.#terminated = true;
		this.#socket?.close();
	}

	async import(data: string): Promise<void> {
		if (!this.#state) {
			throw new ConnectionUnavailable();
		}

		const endpoint = new URL(this.#state.url);
		const basepath = endpoint.pathname.slice(0, -4);

		endpoint.pathname = `${basepath}/import`;

		await postEndpoint(this.#context, this.#state, data, endpoint, {
			Accept: "application/json",
		});
	}

	async export(options?: Partial<ExportOptions>): Promise<string> {
		if (!this.#state) {
			throw new ConnectionUnavailable();
		}

		const endpoint = new URL(this.#state.url);
		const basepath = endpoint.pathname.slice(0, -4);

		endpoint.pathname = `${basepath}/export`;

		const buffer = await postEndpoint(
			this.#context,
			this.#state,
			options ?? {},
			endpoint,
			{
				Accept: "plain/text",
			},
		);

		return new TextDecoder("utf-8").decode(buffer);
	}

	send<Method extends string, Params extends unknown[] | undefined, Result>(
		request: RpcRequest<Method, Params>,
	): Promise<RpcResponse<Result>> {
		return new Promise((resolve, reject) => {
			if (!this.#active) {
				reject(new ConnectionUnavailable());
				return;
			}

			const id = getIncrementalID();
			const call: Call<Result> = {
				request: { id, ...request },
				resolve,
				reject,
			};

			this.#calls.set(id, call as Call<unknown>);
			this.#socket?.send(this.#context.encode(call.request));
		});
	}

	private async createSocket(onConnected: () => void): Promise<Error | null> {
		return new Promise((resolve, reject) => {
			if (!this.#state) {
				reject(new ConnectionUnavailable());
				return;
			}

			// Open a new connection
			const socket = new WebSocket(this.#state.url.toString(), "cbor");

			this.#socket = socket;

			// Store connection errors
			let caughtError: Error | null = null;

			// Wait for the connection to open
			socket.addEventListener("open", onConnected);

			// Handle any errors
			socket.addEventListener("error", (e) => {
				const error = new UnexpectedConnectionError(
					"detail" in e && e.detail
						? e.detail
						: "message" in e && e.message
							? e.message
							: "error" in e && e.error
								? e.error
								: "An unexpected error occurred",
				);

				this.#publisher.publish("error", error);
				caughtError = error;
			});

			// Handle connection closure
			socket.addEventListener("close", () => {
				clearInterval(this.#pinger);
				resolve(caughtError);
			});

			// Handle any messages
			socket.addEventListener("message", async ({ data }) => {
				try {
					const buffer = await this.parseBuffer(data);
					const decoded = this.#context.decode<Response>(buffer);

					if (
						typeof decoded === "object" &&
						decoded != null &&
						Object.getPrototypeOf(decoded) === Object.prototype
					) {
						this.handleRpcResponse(decoded);
					} else {
						throw new UnexpectedServerResponse(decoded);
					}
				} catch (detail) {
					socket.dispatchEvent(new CustomEvent("error", { detail }));
				}
			});
		});
	}

	private async parseBuffer(data: unknown) {
		if (data instanceof ArrayBuffer) {
			return data;
		}

		if (data instanceof Blob) {
			return await data.arrayBuffer();
		}

		if (data instanceof Uint8Array) {
			return data.buffer.slice(
				data.byteOffset,
				data.byteOffset + data.byteLength,
			);
		}

		throw new UnexpectedServerResponse(data);
	}

	private handleRpcResponse({ id, ...res }: Response) {
		if (typeof id === "string") {
			try {
				const { resolve } = this.#calls.get(id) ?? {};
				resolve?.(res as RpcResponse<unknown>);
			} finally {
				this.#calls.delete(id);
			}

			return;
		}

		if (isLiveResult(res.result)) {
			const { id, action, result } = res.result;

			this.#publisher.publish("live", id, action, result);
			return;
		}

		this.#publisher.publish("error", new UnexpectedServerResponse(res));
	}
}
