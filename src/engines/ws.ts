import { WebSocket } from "isows";
import {
	ConnectionUnavailable,
	EngineDisconnected,
	FeatureUnavailableForEngine,
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
import { getIncrementalID } from "../util/get-incremental-id";
import { retrieveRemoteVersion } from "../util/version-check";
import {
	AbstractEngine,
	ConnectionStatus,
	type EngineContext,
	type EngineEvents,
} from "./abstract";

export class WebsocketEngine extends AbstractEngine {
	private pinger?: Pinger;
	private socket?: WebSocket;

	constructor(context: EngineContext) {
		super(context);
		this.emitter.subscribe("disconnected", () => this.pinger?.stop());
	}

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
		this.setStatus(ConnectionStatus.Connecting);
		const socket = new WebSocket(url.toString(), "cbor");
		const ready = new Promise<void>((resolve, reject) => {
			socket.addEventListener("open", () => {
				this.setStatus(ConnectionStatus.Connected);
				resolve();
			});

			socket.addEventListener("error", (e) => {
				const error = new UnexpectedConnectionError(
					"error" in e ? e.error : "An unexpected error occurred",
				);
				this.setStatus(ConnectionStatus.Error, error);
				reject(error);
			});

			socket.addEventListener("close", () => {
				this.setStatus(ConnectionStatus.Disconnected);
			});

			socket.addEventListener("message", async ({ data }) => {
				try {
					const decoded = this.decodeCbor(
						data instanceof Blob
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
		});

		this.ready = ready;
		return await ready.then(() => {
			this.socket = socket;
			this.pinger?.stop();
			this.pinger = new Pinger(30000);
			this.pinger.start(() => this.rpc({ method: "ping" }));
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
	>(request: RpcRequest<Method, Params>): Promise<RpcResponse<Result>> {
		await this.ready;
		if (!this.socket) throw new ConnectionUnavailable();

		// It's not realistic for the message to ever arrive before the listener is registered on the emitter
		// And we don't want to collect the response messages in the emitter
		// So to be sure we simply subscribe before we send the message :)

		const id = getIncrementalID();
		const response = this.emitter.subscribeOnce(`rpc-${id}`);
		this.socket.send(this.encodeCbor({ id, ...request }));

		const [res] = await response;
		if (res instanceof EngineDisconnected) throw res;

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

	async export(options?: ExportOptions): Promise<string> {
		throw new FeatureUnavailableForEngine();
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
