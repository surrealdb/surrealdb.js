import type { EngineDisconnected } from "../errors";
import {
	convertAuth,
	type AuthClient,
	type ExportOptions,
	type LiveHandlerArguments,
	type RpcRequest,
	type RpcResponse,
	type ScopeAuth,
	type AccessRecordAuth,
	type AnyAuth,
	type Token,
} from "../types";
import type { Emitter } from "../util/emitter";
import { processAuthVars } from "../util/process-auth-vars";
import type { ReconnectContext } from "../util/reconnect";

export type Engine = new (context: EngineContext) => AbstractEngine;
export type Engines = Record<string, Engine>;
export const RetryMessage: unique symbol = Symbol("RetryMessage");

export type EngineEvents = {
	connecting: [];
	connected: [];
	reconnecting: [];
	disconnected: [];
	error: [Error];

	[K: `rpc-${string | number}`]: [
		RpcResponse | EngineDisconnected | typeof RetryMessage,
	];
	[K: `live-${string}`]: LiveHandlerArguments;
};

export enum ConnectionStatus {
	Disconnected = "disconnected",
	Connecting = "connecting",
	Reconnecting = "reconnecting",
	Connected = "connected",
	Error = "error",
}

export class EngineContext {
	readonly emitter: Emitter<EngineEvents>;
	readonly encodeCbor: (value: unknown) => ArrayBuffer;
	// biome-ignore lint/suspicious/noExplicitAny: Don't know what it will return
	readonly decodeCbor: (value: ArrayBufferLike) => any;
	readonly reconnect: ReconnectContext;

	constructor({
		emitter,
		encodeCbor,
		decodeCbor,
		reconnect,
	}: {
		emitter: Emitter<EngineEvents>;
		encodeCbor: (value: unknown) => ArrayBuffer;
		// biome-ignore lint/suspicious/noExplicitAny: Don't know what it will return
		decodeCbor: (value: ArrayBufferLike) => any;
		reconnect: ReconnectContext;
	}) {
		this.emitter = emitter;
		this.encodeCbor = encodeCbor;
		this.decodeCbor = decodeCbor;
		this.reconnect = reconnect;
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
	abstract export(options?: Partial<ExportOptions>): Promise<string>;

	// protected authClient(): AuthClient {
	// 	const self = this;

	// 	return {
	// 		async signup(vars: ScopeAuth | AccessRecordAuth): Promise<Token> {
	// 			const parsed = processAuthVars(vars, self.connection);
	// 			const converted = convertAuth(parsed);
	// 			const res: RpcResponse<Token> = await self.rpc({
	// 				method: "signup",
	// 				params: [converted],
	// 			});

	// 			if (res.error) throw new ResponseError(res.error.message);
	// 			if (!res.result) {
	// 				throw new NoTokenReturned();
	// 			}

	// 			return res.result;
	// 		}

	// 		async signin(vars: AnyAuth): Promise<Token> {
	// 			if (!this.connection) throw new NoActiveSocket();

	// 			const parsed = processAuthVars(vars, this.connection.connection);
	// 			const converted = convertAuth(parsed);
	// 			const res = await this.rpc<Token>("signin", [converted]);

	// 			if (res.error) throw new ResponseError(res.error.message);
	// 			if (!res.result) {
	// 				throw new NoTokenReturned();
	// 			}

	// 			return res.result;
	// 		}

	// 		async authenticate(token: Token): Promise<true> {
	// 			const res = await this.rpc<string>("authenticate", [token]);
	// 			if (res.error) throw new ResponseError(res.error.message);
	// 			return true;
	// 		}

	// 		async invalidate(): Promise<true> {
	// 			const res = await this.rpc("invalidate");
	// 			if (res.error) throw new ResponseError(res.error.message);
	// 			return true;
	// 		}
	// 	}
	// }
}
