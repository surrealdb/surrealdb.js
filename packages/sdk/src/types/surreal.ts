import type { EventPublisher } from "./publisher";
import type { ExportOptions } from "./export";
import type { RpcRequest, RpcResponse } from "./rpc";

export type EngineEvents = {
	connecting: [];
	connected: [];
	reconnecting: [];
	disconnected: [];
	error: [Error];
	live: [string, unknown];
};

/**
 * An engine responsible for communicating to a SurrealDB datastore
 */
export interface SurrealEngine extends EventPublisher<EngineEvents> {
	open(endpoint: URL): Promise<void>;
	close(): Promise<void>;

	version(timeout?: number): Promise<string>;
	export(options?: Partial<ExportOptions>): Promise<string>;
	import(data: string): Promise<void>;

	rpc<Method extends string, Params extends unknown[] | undefined, Result>(
		request: RpcRequest<Method, Params>,
		force?: boolean,
	): Promise<RpcResponse<Result>>;
}

/**
 * A controller responsible for implementing a communication protocol
 */
export interface SurrealController {}

export interface DriverOptions {}

export interface ConnectOptions {}
