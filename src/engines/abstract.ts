import type { LiveHandlerArguments, RpcRequest, RpcResponse } from "../types";

import type { EngineDisconnected } from "../errors";
import type { Emitter } from "../util/emitter";

export type Engine = new (context: EngineContext) => AbstractEngine;
export type Engines = Record<string, Engine>;

export type EngineEvents = {
	connecting: [];
	connected: [];
	disconnected: [];
	reconnecting: [];
	error: [Error];

	[K: `rpc-${string | number}`]: [RpcResponse | EngineDisconnected];
	[K: `live-${string}`]: LiveHandlerArguments;
};

export enum ConnectionStatus {
	Disconnected = "disconnected",
	Connecting = "connecting",
	Connected = "connected",
	Error = "error",
}

export class EngineContext {
	readonly emitter: Emitter<EngineEvents>;
	readonly encodeCbor: (value: unknown) => ArrayBuffer;
	// biome-ignore lint/suspicious/noExplicitAny: Don't know what it will return
	readonly decodeCbor: (value: ArrayBufferLike) => any;

	constructor({
		emitter,
		encodeCbor,
		decodeCbor,
	}: {
		emitter: Emitter<EngineEvents>;
		encodeCbor: (value: unknown) => ArrayBuffer;
		// biome-ignore lint/suspicious/noExplicitAny: Don't know what it will return
		decodeCbor: (value: ArrayBufferLike) => any;
	}) {
		this.emitter = emitter;
		this.encodeCbor = encodeCbor;
		this.decodeCbor = decodeCbor;
	}
}

export abstract class AbstractEngine {
	readonly context: EngineContext;
	ready: Promise<void> | undefined;
	status: ConnectionStatus = ConnectionStatus.Disconnected;
	connection: {
		url: URL | undefined;
		namespace: string | undefined;
		database: string | undefined;
		token: string | undefined;
	} = {
		url: undefined,
		namespace: undefined,
		database: undefined,
		token: undefined,
	};

	constructor(context: EngineContext) {
		this.context = context;
	}

	get emitter(): EngineContext["emitter"] {
		return this.context.emitter;
	}

	get encodeCbor(): EngineContext["encodeCbor"] {
		return this.context.encodeCbor;
	}

	get decodeCbor(): EngineContext["decodeCbor"] {
		return this.context.decodeCbor;
	}

	abstract connect(url: URL): Promise<void>;
	abstract disconnect(): Promise<void>;
	abstract rpc<
		Method extends string,
		Params extends unknown[] | undefined,
		Result,
	>(request: RpcRequest<Method, Params>): Promise<RpcResponse<Result>>;

	abstract version(url: URL, timeout?: number): Promise<string>;
}
