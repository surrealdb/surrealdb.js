import type { EventPublisher } from "./publisher";
import type { ExportOptions } from "./export";
import type { RpcRequest, RpcResponse } from "./rpc";
import type { AnyAuth, Token } from "./auth";
import type { ReconnectContext } from "../internal/reconnect";
import type { decodeCbor, encodeCbor } from "../cbor";
import type { LiveAction } from "./live";
import type { Uuid } from "../value";

export type EngineImpl = new (context: DriverContext) => SurrealEngine;

export type EngineEvents = {
	connecting: [];
	connected: [];
	reconnecting: [];
	disconnected: [];
	error: [Error];
	live: [Uuid, LiveAction, unknown];
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
	// TODO custom encodeCbor decodeCbor
}

/**
 * Options used to customize a specific connection to a SurrealDB datastore
 */
export interface ConnectOptions {
	/** The namespace to connect to */
	namespace?: string;
	/** The database to connect to */
	database?: string;
	/** Authentication details to use */
	authenticate?: () => AnyAuth | Token;
	/** Enable automated SurrealDB version checking */
	versionCheck?: boolean;
	/** Configure reconnect behavior for supported engines */
	reconnect?: boolean | Partial<ReconnectOptions>;
}

/**
 * Options to configure reconnect behavior
 */
export interface ReconnectOptions {
	/** Reconnect after a connection has unexpectedly dropped */
	enabled: boolean;
	/** How many attempts will be made at reconnecting, -1 for unlimited */
	attempts: number;
	/** The minimum amount of time in milliseconds to wait before reconnecting */
	retryDelay: number;
	/** The maximum amount of time in milliseconds to wait before reconnecting */
	retryDelayMax: number;
	/** The amount to multiply the delay by after each failed attempt */
	retryDelayMultiplier: number;
	/** A float percentage to randomly offset each delay by  */
	retryDelayJitter: number;
	/** Handle errors caught during reconnecting */
	catch?: (error: Error) => boolean;
}

/**
 * The current state of a connection to a SurrealDB datastore
 */
export interface ConnectionState {
	url: URL;
	reconnect: ReconnectContext;
	namespace?: string;
	database?: string;
	token?: string;
}

/**
 * Context information passed to each controller and engine
 */
export interface DriverContext {
	options: DriverOptions;
	encode: typeof encodeCbor;
	decode: typeof decodeCbor;
}
