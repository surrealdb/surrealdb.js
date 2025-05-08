import type { decodeCbor, encodeCbor } from "../cbor";
import type { ReconnectContext } from "../internal/reconnect";
import type { AuthProvider } from "./auth";
import type { ExportOptions } from "./export";
import type { LiveMessage } from "./live";
import type { EventPublisher } from "./publisher";
import type { RpcRequest, RpcResponse } from "./rpc";

export type ConnectionStatus =
	| "disconnected"
	| "connecting"
	| "reconnecting"
	| "connected";

export type EngineImpl = new (context: DriverContext) => SurrealEngine;

export type EngineEvents = {
	connecting: [];
	connected: [];
	reconnecting: [];
	disconnected: [];
	error: [Error];
	live: [LiveMessage];
};

/**
 * An engine responsible for communicating to a SurrealDB datastore
 */
export interface SurrealEngine extends EventPublisher<EngineEvents> {
	open(state: ConnectionState): void;
	close(): Promise<void>;

	export(options?: Partial<ExportOptions>): Promise<string>;
	import(data: string): Promise<void>;

	send<Method extends string, Params extends unknown[] | undefined, Result>(
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
	/** The namespace to connect to */
	namespace?: string;
	/** The database to connect to */
	database?: string;
	/** Authentication details to use */
	authentication?: AuthProvider;
	/** Automatically check for version compatibility on connect @default true */
	versionCheck?: boolean;
	/** Configure reconnect behavior for supported engines @default false */
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
	variables: Record<string, unknown>;
	namespace?: string;
	database?: string;
	accessToken?: string;
	refreshToken?: string;
}

/**
 * Context information passed to each controller and engine
 */
export interface DriverContext {
	options: DriverOptions;
	encode: typeof encodeCbor;
	decode: typeof decodeCbor;
}
