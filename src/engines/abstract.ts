import type {
	decodeCbor as _decodeCbor,
	encodeCbor as _encodeCbor,
} from "../data";
import type { EngineDisconnected } from "../errors";
import type { LiveAction, Patch, RpcRequest, RpcResponse } from "../types";
import type { Emitter } from "../util/emitter";

export type Engine = new (context: EngineContext) => AbstractEngine;
export type Engines = Record<string, Engine>;

export type EngineEvents = {
	connecting: [];
	connected: [];
	disconnected: [];
	error: [Error];

	[K: `rpc-${string | number}`]: [RpcResponse | EngineDisconnected];
	[K: `live-${string}`]: [LiveAction, Record<string, unknown> | Patch];
};

export enum ConnectionStatus {
	Disconnected = "disconnected",
	Connecting = "connecting",
	Connected = "connected",
	Error = "error",
}

export class EngineContext {
	readonly emitter: Emitter<EngineEvents>;
	readonly encodeCbor: typeof _encodeCbor;
	readonly decodeCbor: typeof _decodeCbor;

	constructor({
		emitter,
		encodeCbor,
		decodeCbor,
	}: {
		emitter: Emitter<EngineEvents>;
		encodeCbor: typeof _encodeCbor;
		decodeCbor: typeof _decodeCbor;
	}) {
		this.emitter = emitter;
		this.encodeCbor = encodeCbor;
		this.decodeCbor = decodeCbor;
	}
}

export abstract class AbstractEngine {
	readonly context: EngineContext;
	ready: Promise<void> | undefined;
	status = ConnectionStatus.Disconnected;
	connection: {
		url?: URL;
		namespace?: string;
		database?: string;
		token?: string;
	} = {};

	constructor(context: EngineContext) {
		this.context = context;
	}

	get emitter() {
		return this.context.emitter;
	}

	get encodeCbor() {
		return this.context.encodeCbor;
	}

	get decodeCbor() {
		return this.context.decodeCbor;
	}

	abstract connect(url: URL): Promise<void>;
	abstract disconnect(): Promise<void>;
	abstract rpc<
		Method extends string,
		Params extends unknown[] | undefined,
		Result,
	>(request: RpcRequest<Method, Params>): Promise<RpcResponse<Result>>;

	abstract version(url: URL, timeout: number): Promise<string>;
}
