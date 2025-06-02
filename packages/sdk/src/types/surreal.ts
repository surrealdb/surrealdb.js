import type { decodeCbor, encodeCbor } from "../cbor";
import type { ReconnectContext } from "../internal/reconnect";
import type { AuthProvider, AuthRenewer } from "./auth";
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
	websocketImpl?: typeof WebSocket;
}

/**
 * Options used to customize a specific connection to a SurrealDB datastore
 */
export interface ConnectOptions {
	/**
	 * The namespace to use for this connection.
	 */
	namespace?: string;
	/**
	 * The database to use for this connection.
	 */
	database?: string;
	/**
	 * Authentication details to use when connecting to the datastore. You can provide a static value,
	 * or a function which is called to retrieve the authentication details. Authentication details
	 * may be requested on connect, reconnect, or when the access token expires.
	 */
	authentication?: AuthProvider;
	/**
	 * Automatically check for version compatibility on connect. When the version is not supported,
	 * an error will be thrown and the connection will not be established.
	 *
	 * @default true
	 */
	versionCheck?: boolean;
	/**
	 * Configure automatic session renewal.
	 *
	 * - When set to `false`, the driver will invalidate the session when the access token expires.
	 * - When set to `true`, the driver will renew the session using the configured `authentication` details.
	 * - When set to a function, the function will be called to renew the session.
	 *
	 * @default true
	 */
	renewAccess?: AuthRenewer;
	/**
	 * Configure reconnect behavior for supported engines (WebSocket).
	 *
	 * - When set to `false`, the driver will remain disconnected after a connection is lost.
	 * - When set to `true`, the driver will attempt to reconnect using default options.
	 * - When set to an object, the driver will attempt to reconnect using the provided options.
	 *
	 * @default true
	 */
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
