import { WebSocket } from "isows";
import {
	ConnectionUnavailable,
	EngineDisconnected,
	NoURLProvided,
	ReconnectFailed,
	ResponseError,
	UnexpectedConnectionError,
	UnexpectedServerResponse,
} from "../errors";
import {
	type ExportOptions,
	type RpcRequest,
	type RpcResponse,
	isLiveResult,
} from "../types";
import { newCompletable } from "../util/completable";
import { getIncrementalID } from "../util/get-incremental-id";
import { retrieveRemoteVersion } from "../util/version-check";
import { ConnectionStatus, RetryMessage, type EngineEvents } from "./abstract";
import { AbstractRemoteEngine } from "./abstract-remote";

export class WebsocketEngine extends AbstractRemoteEngine {
	private pinger?: Pinger;
	private socket?: WebSocket;

	private setStatus<T extends ConnectionStatus>(
		status: T,
		...args: EngineEvents[T]
	) {
		this.status = status;
		this.emitter.emit(status, args);
	}

	private async requireStatus<T extends ConnectionStatus>(
		status: T,
	): Promise<true> {
		if (this.status !== status) {
			await this.emitter.subscribeOnce(status);
		}

		return true;
	}

	version(url: URL, timeout?: number): Promise<string> {
		return retrieveRemoteVersion(url, timeout);
	}

	async connect(url: URL): Promise<void> {
		this.connection.url = url;

		// Create an async loop
		(async () => {
			let initial = true;
			let controls: [() => void, (reason?: Error) => void] | undefined =
				undefined;

			while (this.connection.url) {
				if (initial) {
					initial = false;
					this.setStatus(ConnectionStatus.Connecting);
					this.ready = this.createSocket();
					await this.emitter.subscribeOnce(ConnectionStatus.Disconnected);
				} else {
					// Check if reconnecting is enabled
					if (!this.context.reconnect.enabled) {
						break;
					}

					// Configure controls for the promise if they are currently lacking
					if (!controls) {
						const { promise, resolve, reject } = newCompletable();
						this.ready = promise;
						controls = [resolve, reject];
					}

					// Obtain the controls for the promise
					const [resolve, reject] = controls;

					// Try to iterate
					if (!(await this.context.reconnect.iterate())) {
						return reject(new ReconnectFailed());
					}

					// Emit the status
					this.setStatus(ConnectionStatus.Reconnecting);

					// Attempt to reconnect
					await this.createSocket()
						.then(async () => {
							// Reconfigure the namespace and database
							if (this.connection.namespace || this.connection.database) {
								await this.rpc(
									{
										method: "use",
										params: [
											this.connection.namespace,
											this.connection.database,
										],
									},
									true,
								);
							}

							// Reconfigure the authentication details
							if (this.connection.token) {
								await this.rpc(
									{
										method: "authenticate",
										params: [this.connection.token],
									},
									true,
								);
							}

							// Reset the reconnection status
							this.context.reconnect.reset();

							// Unblock the connection
							resolve();

							// Scan all pending rpc requests
							const pending = this.emitter.scanListeners((k) =>
								k.startsWith("rpc-"),
							);
							// Ensure all rpc requests receive a retry symbol
							pending.map((k) => this.emitter.emit(k, [RetryMessage]));
						})
						// Ignore any error
						// the connection failed, let's try again
						.catch(() => {});

					// If we are connection, wait for the connection to be dropped
					if (this.status === ConnectionStatus.Connected) {
						await this.emitter.subscribeOnce(ConnectionStatus.Disconnected);
					}
				}
			}
		})();

		await this.ready;
	}

	private async createSocket() {
		const { promise, resolve, reject } = newCompletable();

		// Validate requirements
		if (!this.connection.url) {
			throw new NoURLProvided();
		}

		// Open a new connection
		const socket = new WebSocket(this.connection.url.toString(), "cbor");

		// Wait for the connection to open
		socket.addEventListener("open", () => {
			this.setStatus(ConnectionStatus.Connected);
			resolve();
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
			this.setStatus(ConnectionStatus.Error, error);
			reject(error);
		});

		// Handle connection closure
		socket.addEventListener("close", () => {
			this.setStatus(ConnectionStatus.Disconnected);
			this.pinger?.stop();
		});

		// Handle any messages
		socket.addEventListener("message", async ({ data }) => {
			try {
				const decoded = this.decodeCbor(
					data instanceof ArrayBuffer
						? data
						: data instanceof Blob
							? await data.arrayBuffer()
							: data.buffer.slice(
									data.byteOffset,
									data.byteOffset + data.byteLength,
								),
				);

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

		await promise.then(() => {
			this.socket = socket;
			this.pinger?.stop();
			this.pinger = new Pinger(30000);
			this.pinger.start(() => {
				try {
					this.rpc({ method: "ping" });
				} catch {
					// we are not interested in the result
				}
			});
		});
	}

	async disconnect(): Promise<void> {
		this.connection = {
			url: undefined,
			namespace: undefined,
			database: undefined,
			token: undefined,
		};

		await this.ready?.catch(() => {});
		this.socket?.close();
		this.ready = undefined;
		this.socket = undefined;

		await Promise.any([
			this.requireStatus(ConnectionStatus.Disconnected),
			this.requireStatus(ConnectionStatus.Error),
		]);
	}

	async rpc<
		Method extends string,
		Params extends unknown[] | undefined,
		Result,
	>(
		request: RpcRequest<Method, Params>,
		force?: boolean,
	): Promise<RpcResponse<Result>> {
		if (!force) await this.ready;
		if (!this.socket) throw new ConnectionUnavailable();

		let res: RpcResponse | undefined = undefined;
		while (!res) {
			// It's not realistic for the message to ever arrive before the listener is registered on the emitter
			// And we don't want to collect the response messages in the emitter
			// So to be sure we simply subscribe before we send the message :)

			const id = getIncrementalID();
			const response = this.emitter.subscribeOnce(`rpc-${id}`);
			this.socket.send(this.encodeCbor({ id, ...request }));

			const [raw] = await response;
			if (raw instanceof EngineDisconnected) throw raw;
			if (raw === RetryMessage) continue;
			res = raw;
		}

		if ("result" in res) {
			switch (request.method) {
				case "use": {
					const [ns, db] = request.params as [
						string | null | undefined,
						string | null | undefined,
					];

					if (ns === null) this.connection.namespace = undefined;
					if (db === null) this.connection.database = undefined;
					if (ns) this.connection.namespace = ns;
					if (db) this.connection.database = db;
					break;
				}

				case "signin":
				case "signup": {
					this.connection.token = res.result as string;
					break;
				}

				case "authenticate": {
					const [token] = request.params as [string];
					this.connection.token = token;
					break;
				}

				case "invalidate": {
					this.connection.token = undefined;
					break;
				}
			}
		}

		return res as RpcResponse<Result>;
	}

	// biome-ignore lint/suspicious/noExplicitAny: Cannot assume type
	handleRpcResponse({ id, ...res }: any): void {
		if (id) {
			this.emitter.emit(`rpc-${id}`, [res]);
		} else if (res.error) {
			this.setStatus(ConnectionStatus.Error, new ResponseError(res.error));
		} else {
			if (isLiveResult(res.result)) {
				const { id, action, result } = res.result;
				this.emitter.emit(`live-${id}`, [action, result], true);
			} else {
				this.setStatus(
					ConnectionStatus.Error,
					new UnexpectedServerResponse({ id, ...res }),
				);
			}
		}
	}

	get connected(): boolean {
		return !!this.socket;
	}

	async export(options?: Partial<ExportOptions>): Promise<string> {
		if (!this.connection.url) {
			throw new ConnectionUnavailable();
		}
		const url = new URL(this.connection.url);
		const basepath = url.pathname.slice(0, -4);
		url.protocol = url.protocol.replace("ws", "http");
		url.pathname = `${basepath}/export`;

		const buffer = await this.req_post(options ?? {}, url, {
			Accept: "plain/text",
		});

		const dec = new TextDecoder("utf-8");
		return dec.decode(buffer);
	}
}

export class Pinger {
	private pinger?: ReturnType<typeof setTimeout>;
	private interval: number;

	constructor(interval = 30000) {
		this.interval = interval;
	}

	start(callback: () => void): void {
		this.pinger = setInterval(callback, this.interval);
	}

	stop(): void {
		clearInterval(this.pinger);
	}
}
