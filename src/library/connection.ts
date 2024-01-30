import { z } from "npm:zod@^3.22.4";
import { Emitter } from "./emitter.ts";
import { getIncrementalID } from "./getIncrementalID.ts";
import { RpcRequest, RpcResponse } from "./rpc.ts";
import WebSocket from "./WebSocket/deno.ts";
import { decode, encode } from "./data/cbor.ts";
import { Action, LiveResult } from "./live.ts";
import { Patch } from "../types.ts";

export type EmitterEvents = {
	'adapter-connecting': [],
	'adapter-connected': [],
	'adapter-disconnected': [],
	'adapter-reconnecting': [],
	'adapter-error': [],

	connecting: [],
	connected: [],
	disconnected: [],
	reconnecting: [],
	error: [Error],

	[K: `rpc-${string | number}`]: [RpcResponse],
	[K: `live-${string}`]: [Action, Record<string, unknown> | Patch],
};

export abstract class Connection {
	abstract emitter: Emitter<EmitterEvents>;
	abstract ready?: Promise<void>;
	abstract connected?: boolean;
	abstract connect(url: string): Promise<void>;
	abstract disconnect(): Promise<void>;
	abstract send<Method extends string, Params extends unknown[] | undefined, Result extends unknown>(request: RpcRequest<Method, Params>): Promise<RpcResponse<Result>>;
	abstract namespace?: string;
	abstract database?: string;
	abstract token?: string;
}

export class WebsocketConnection implements Connection {
	ready?: Promise<void>;

	namespace?: string;
	database?: string;
	token?: string;

	readonly emitter: Emitter<EmitterEvents>;
	private socket?: WebSocket;

	constructor(emitter: Emitter<EmitterEvents>) {
		this.emitter = emitter;
	}

	async connect(url: string) {
		this.emitter.emit('adapter-connecting', []);
		const socket = new WebSocket(url, 'cbor');
		const ready = new Promise<void>((resolve, reject) => {
			socket.addEventListener("open", () => {
				this.emitter.emit('adapter-connected', []);
				resolve();
			});

			socket.addEventListener("error", (e) => {
				const error = 'error' in e ? e.error as Error : new Error("An unexpected error occurred");
				this.emitter.emit("error", [error]);
				reject(error);
			});

			socket.addEventListener("close", () => {
				this.emitter.emit("disconnected", []);
				reject(new Error("Failed to connect"));
			});

			socket.addEventListener("message", async ({ data }) => {
				const { id, ...res } = decode(await data.arrayBuffer());

				if (id) {
					this.emitter.emit(`rpc-${id}`, [res]);
				} else {
					const { id, action, result } = LiveResult.parse(res.result);
					this.emitter.emit(`live-${id}`, [action, result], true);
				}
			})
		})

		this.ready = ready;
		return await ready.finally(() => {
			this.socket = socket;
		});
	}

	async disconnect(): Promise<void> {
		await this.ready;
		if (!this.socket) throw new Error("Connection unavailable");
	}

	async send<Method extends string, Params extends unknown[] | undefined, Result extends unknown>(request: RpcRequest<Method, Params>): Promise<RpcResponse<Result>> {
		await this.ready;
		if (!this.socket) throw new Error("Connection unavailable");

		// It's not realistic for the message to ever arrive before the listener is registered on the emitter
		// And we don't want to collect the response messages in the emitter
		// So to be sure we simply subscribe before we send the message :)

		const id = getIncrementalID();
		const response = this.emitter.subscribeOnce(`rpc-${id}`);
		this.socket.send(encode({ id, ...request }));
		return response.then(([res]) => {
			this.persistState(request as RpcRequest, res);
			return res as RpcResponse<Result>;
		});
	}

	persistState(request: RpcRequest, response: RpcResponse) {
		if (request.method == 'use' && response.result == undefined) {
			this.namespace = z.string().parse(request.params?.[0]);
			this.database = z.string().parse(request.params?.[1]);
		}

		if (request.method == 'authenticate' && response.result == undefined) {
			this.token = z.string().parse(request.params?.[0]);
		}

		if (request.method == 'invalidate' && response.result == undefined) {
			this.token = undefined;
		}

		if (request.method == 'signin' && typeof response.result == 'string') {
			this.token = response.result
		}

		if (request.method == 'signup' && typeof response.result == 'string') {
			this.token = response.result
		}
	}

	get connected() {
		return !!this.socket;
	}
}

export class HttpConnection implements Connection {
	ready?: Promise<void>;
	readonly emitter: Emitter<EmitterEvents>;
	private connection?: {
		url: string;
		namespace?: string;
		database?: string;
		token?: string;
	}

	constructor(emitter: Emitter<EmitterEvents>) {
		this.emitter = emitter;
	}

	connect(url: string) {
		this.emitter.emit('connecting', []);
		this.connection = { url };
		this.emitter.emit('connected', []);
		this.ready = new Promise<void>(r => r())
		return this.ready;
	}

	disconnect(): Promise<void> {
		this.connection = undefined;
		this.emitter.emit('disconnected', []);
		return new Promise<void>(r => r());
	}

	async send<Method extends string, Params extends unknown[] | undefined, Result extends unknown>(request: RpcRequest<Method, Params>): Promise<RpcResponse<Result>> {
		await this.ready;
		if (!this.connection) {
			throw new Error("Connection unavailable");
		}

		if (request.method == 'use') {
			const [namespace, database] = z.array(z.string()).parse(request.params);
			if (namespace) this.connection.namespace = namespace;
			if (database) this.connection.database = database;
		}

		if (!this.connection.namespace || !this.connection.database) {
			throw new Error("Connection unavailable");
		}

		const id = getIncrementalID();
		const response = await fetch(`${this.connection.url}/rpc`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Accept: "application/json",
				NS: this.connection.namespace,
				DB: this.connection.database,
				...(this.connection.token ? { Authorization: `Bearer ${this.connection.token}`} : {})
			},
			body: JSON.stringify({ id, ...request })
		})
			.then(res => res.json())
			.then(([res]) => res as RpcResponse);

		this.emitter.emit(`rpc-${id}`, [response]);
		return response as RpcResponse<Result>;
	}

	get connected() {
		return !!this.connection;
	}
}
