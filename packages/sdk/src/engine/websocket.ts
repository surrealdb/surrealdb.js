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
import type { ExportOptions } from "../types/export";
import { isLiveMessage } from "../types/live";
import type { RpcRequest, RpcResponse } from "../types/rpc";
import { Publisher } from "../utils/publisher";

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

	subscribe<K extends keyof EngineEvents>(
		event: K,
		listener: (...payload: EngineEvents[K]) => void,
	): () => void {
		return this.#publisher.subscribe(event, listener);
	}

	constructor(context: DriverContext) {
		this.#context = context;
	}

	open(state: ConnectionState): void {
		this.#publisher.publish("connecting");
		this.#terminated = false;
		this.#state = state;

		const { reconnect } = state;

		(async () => {
			while (true) {
				// Open a new socket and await until closure
				const error = await this.createSocket(() => {
					this.#active = true;
					reconnect.reset();

					for (const { request } of this.#calls.values()) {
						this.#socket?.send(this.#context.encode(request));
					}

					this.#publisher.publish("connected");
				});

				this.#socket = undefined;

				if (error) {
					this.#publisher.publish("error", error);
				}

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

					this.#state = undefined;
					this.#active = false;
					this.#calls.clear();
					this.#publisher.publish("disconnected");

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
	}

	async close(): Promise<void> {
		this.#state = undefined;
		this.#terminated = true;
		this.#socket?.close();

		if (this.#active) {
			await this.#publisher.subscribeFirst("disconnected");
		}
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
			const WebSocketImpl = this.#context.options.websocketImpl ?? WebSocket;
			const socket = new WebSocketImpl(this.#state.url.toString(), "cbor");
			if (socket.binaryType === "blob") socket.binaryType = "arraybuffer";

			this.#socket = socket;

			// Store connection errors
			let caughtError: Error | null = null;

			// Wait for the connection to open
			socket.addEventListener("open", () => {
				try {
					onConnected();

					this.#pinger = setInterval(() => {
						try {
							this.send({ method: "ping" });
						} catch {
							// we are not interested in the result
						}
					}, 30_000);
				} catch (err: unknown) {
					caughtError = err as Error;
					socket.close();
				}
			});

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

				caughtError = error;
			});

			// Handle connection closure
			socket.addEventListener("close", () => {
				clearInterval(this.#pinger);
				resolve(caughtError);
			});

			// Handle any messages
			socket.addEventListener("message", ({ data }) => {
				try {
					const buffer = this.parseBuffer(data);
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

	private parseBuffer(data: unknown) {
		if (data instanceof Uint8Array) {
			return data;
		}

		if (data instanceof ArrayBuffer) {
			return new Uint8Array(data);
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

		if (isLiveMessage(res.result)) {
			this.#publisher.publish("live", res.result);
			return;
		}

		this.#publisher.publish("error", new UnexpectedServerResponse(res));
	}
}
