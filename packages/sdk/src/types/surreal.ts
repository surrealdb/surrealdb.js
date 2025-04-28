import type { EventPublisher } from "./publisher";
import type { ExportOptions } from "./export";
import type { RpcRequest, RpcResponse } from "./rpc";

export type ControllerImpl = new (context: DriverContext) => SurrealController;
export type EngineImpl = new (context: DriverContext) => SurrealEngine;

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
	open(state: ConnectionState): Promise<void>;
	close(): Promise<void>;

	export(options?: Partial<ExportOptions>): Promise<string>;
	import(data: string): Promise<void>;

	send<Method extends string, Params extends unknown[] | undefined, Result>(
		request: RpcRequest<Method, Params>,
	): Promise<RpcResponse<Result>>;
}

/**
 * A controller responsible for implementing a communication protocol
 */
export interface SurrealController {
	open(state: ConnectionState): Promise<void>;
	close(): Promise<void>;

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	rpc<Method extends string, Params extends unknown[] | undefined, Result>(
		request: RpcRequest<Method, Params>,
	): Promise<RpcResponse<Result>>;
}

/**
 * Options used to configure behavior of the SurrealDB driver
 */
export interface DriverOptions {
	engines?: Record<string, EngineImpl>;
}

/**
 * Options used to customize a specific connection to a SurrealDB datastore
 */
export interface ConnectOptions {
	controller?: ControllerImpl;
}

/**
 * The current state of a connection to a SurrealDB datastore
 */
export interface ConnectionState {
	url: URL;
	namespace?: string;
	database?: string;
	token?: string;
}

/**
 * Context information passed to each controller and engine
 */
export interface DriverContext {
	options: DriverOptions;
}
