import { z } from "zod";
import type { Emitter } from "./emitter.ts";
import { getIncrementalID } from "./getIncrementalID.ts";
import WebSocket from "./WebSocket/deno.ts";
import { decodeCbor, encodeCbor } from "./cbor/index.ts";
import type { Action, Patch, RpcRequest, RpcResponse } from "../types.ts";
import { LiveResult } from "../types.ts";
import {
	ConnectionUnavailable,
	EngineDisconnected,
	HttpConnectionError,
	MissingNamespaceDatabase,
	ResponseError,
	UnexpectedConnectionError,
	UnexpectedServerResponse,
} from "../errors.ts";
import { retrieveRemoteVersion } from "./versionCheck.ts";

export type EngineEvents = {
	connecting: [];
	connected: [];
	disconnected: [];
	error: [Error];

	[K: `rpc-${string | number}`]: [RpcResponse | EngineDisconnected];
	[K: `live-${string}`]: [Action, Record<string, unknown> | Patch];
};

export enum ConnectionStatus {
	Disconnected = "disconnected",
	Connecting = "connecting",
	Connected = "connected",
	Error = "error",
}

export abstract class Engine {
	constructor(...[_]: [emitter: Emitter<EngineEvents>]) {}
	abstract emitter: Emitter<EngineEvents>;
	abstract ready: Promise<void> | undefined;
	abstract status: ConnectionStatus;
	abstract connect(url: URL): Promise<void>;
	abstract disconnect(): Promise<void>;
	abstract rpc<
		Method extends string,
		Params extends unknown[] | undefined,
		Result extends unknown,
	>(request: RpcRequest<Method, Params>): Promise<RpcResponse<Result>>;
	abstract connection: {
		url?: URL;
		namespace?: string;
		database?: string;
		token?: string;
	};

	abstract version(url: URL, timeout: number): Promise<string>;
}

export class WebsocketEngine implements Engine {
	ready: Promise<void> | undefined = undefined;
	status: ConnectionStatus = ConnectionStatus.Disconnected;
	connection: {
		url?: URL;
		namespace?: string;
		database?: string;
		token?: string;
	} = {};

	readonly emitter: Emitter<EngineEvents>;
	private socket?: WebSocket;

	constructor(emitter: Emitter<EngineEvents>) {
		this.emitter = emitter;
	}

	private setStatus<T extends ConnectionStatus>(
		status: T,
		...args: EngineEvents[T]
	) {
		this.status = status;
		this.emitter.emit(status, args);
	}

	version(url: URL, timeout: number): Promise<string> {
		return retrieveRemoteVersion(url, timeout);
	}

	async connect(url: URL) {
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
				const decoded = decodeCbor(
					data instanceof Blob
						? await data.arrayBuffer()
						: data.buffer.slice(
							data.byteOffset,
							data.byteOffset + data.byteLength,
						),
				);

				if (
					typeof decoded == "object" && !Array.isArray(decoded) &&
					decoded != null
				) {
					this.handleRpcResponse(decoded);
				} else {
					this.setStatus(
						ConnectionStatus.Error,
						new UnexpectedServerResponse(decoded),
					);
				}
			});
		});

		this.ready = ready;
		return await ready.then(() => {
			this.socket = socket;
		});
	}

	async disconnect(): Promise<void> {
		this.connection = {};
		await this.ready?.catch(() => {});
		await this.socket?.close();
		this.ready = undefined;
		this.socket = undefined;
	}

	async rpc<
		Method extends string,
		Params extends unknown[] | undefined,
		Result extends unknown,
	>(request: RpcRequest<Method, Params>): Promise<RpcResponse<Result>> {
		await this.ready;
		if (!this.socket) throw new ConnectionUnavailable();

		// It's not realistic for the message to ever arrive before the listener is registered on the emitter
		// And we don't want to collect the response messages in the emitter
		// So to be sure we simply subscribe before we send the message :)

		const id = getIncrementalID();
		const response = this.emitter.subscribeOnce(`rpc-${id}`);
		this.socket.send(encodeCbor({ id, ...request }));
		return response.then(([res]) => {
			if (res instanceof EngineDisconnected) throw res;

			if ("result" in res) {
				switch (request.method) {
					case "use": {
						this.connection.namespace = z.string().parse(
							request.params?.[0],
						);
						this.connection.database = z.string().parse(
							request.params?.[1],
						);
						break;
					}

					case "signin":
					case "signup": {
						this.connection.token = res.result as string;
						break;
					}

					case "authenticate": {
						this.connection.token = request.params
							?.[0] as string;
						break;
					}

					case "invalidate": {
						delete this.connection.token;
						break;
					}
				}
			}

			return res as RpcResponse<Result>;
		});
	}

	// deno-lint-ignore no-explicit-any
	handleRpcResponse({ id, ...res }: any) {
		if (id) {
			this.emitter.emit(`rpc-${id}`, [res]);
		} else if (res.error) {
			this.setStatus(
				ConnectionStatus.Error,
				new ResponseError(res.error),
			);
		} else {
			const live = LiveResult.safeParse(res.result);
			if (live.success) {
				const { id, action, result } = live.data;
				this.emitter.emit(`live-${id}`, [action, result], true);
			} else {
				this.setStatus(
					ConnectionStatus.Error,
					new UnexpectedServerResponse({ id, ...res }),
				);
			}
		}
	}

	get connected() {
		return !!this.socket;
	}
}

export class HttpEngine implements Engine {
	ready: Promise<void> | undefined = undefined;
	status: ConnectionStatus = ConnectionStatus.Disconnected;
	readonly emitter: Emitter<EngineEvents>;
	connection: {
		url?: URL;
		namespace?: string;
		database?: string;
		token?: string;
		variables: Record<string, unknown>;
	} = { variables: {} };

	constructor(emitter: Emitter<EngineEvents>) {
		this.emitter = emitter;
	}

	private setStatus<T extends ConnectionStatus>(
		status: T,
		...args: EngineEvents[T]
	) {
		this.status = status;
		this.emitter.emit(status, args);
	}

	version(url: URL, timeout: number): Promise<string> {
		return retrieveRemoteVersion(url, timeout);
	}

	connect(url: URL) {
		this.setStatus(ConnectionStatus.Connecting);
		this.connection.url = url;
		this.setStatus(ConnectionStatus.Connected);
		this.ready = new Promise<void>((r) => r());
		return this.ready;
	}

	disconnect(): Promise<void> {
		this.connection = { variables: {} };
		this.ready = undefined;
		this.setStatus(ConnectionStatus.Disconnected);
		return new Promise<void>((r) => r());
	}

	async rpc<
		Method extends string,
		Params extends unknown[] | undefined,
		Result extends unknown,
	>(request: RpcRequest<Method, Params>): Promise<RpcResponse<Result>> {
		await this.ready;
		if (!this.connection.url) {
			throw new ConnectionUnavailable();
		}

		if (request.method == "use") {
			const [namespace, database] = z.tuple([z.string(), z.string()])
				.parse(request.params);
			if (namespace) this.connection.namespace = namespace;
			if (database) this.connection.database = database;
			return {
				result: true as Result,
			};
		}

		if (request.method == "let") {
			const [key, value] = z.tuple([z.string(), z.unknown()]).parse(
				request.params,
			);
			this.connection.variables[key] = value;
			return {
				result: true as Result,
			};
		}

		if (request.method == "unset") {
			const [key] = z.tuple([z.string()]).parse(request.params);
			delete this.connection.variables[key];
			return {
				result: true as Result,
			};
		}

		if (request.method == "query") {
			request.params = [
				request.params?.[0],
				{
					...this.connection.variables,
					...(request.params?.[1] ?? {}),
				},
			] as Params;
		}

		if (!this.connection.namespace || !this.connection.database) {
			throw new MissingNamespaceDatabase();
		}

		const id = getIncrementalID();
		const raw = await fetch(`${this.connection.url}`, {
			method: "POST",
			headers: {
				"Content-Type": "application/cbor",
				Accept: "application/cbor",
				"Surreal-NS": this.connection.namespace,
				"Surreal-DB": this.connection.database,
				...(this.connection.token
					? { Authorization: `Bearer ${this.connection.token}` }
					: {}),
			},
			body: encodeCbor({ id, ...request }),
		});

		const buffer = await raw.arrayBuffer();

		if (raw.status == 200) {
			const response: RpcResponse = decodeCbor(buffer);
			if ("result" in response) {
				switch (request.method) {
					case "signin":
					case "signup": {
						this.connection.token = response.result as string;
						break;
					}

					case "authenticate": {
						this.connection.token = request.params?.[0] as string;
						break;
					}

					case "invalidate": {
						delete this.connection.token;
						break;
					}
				}
			}

			this.emitter.emit(`rpc-${id}`, [response]);
			return response as RpcResponse<Result>;
		} else {
			const dec = new TextDecoder("utf-8");
			throw new HttpConnectionError(
				dec.decode(buffer),
				raw.status,
				raw.statusText,
				buffer,
			);
		}
	}

	get connected() {
		return !!this.connection.url;
	}
}
