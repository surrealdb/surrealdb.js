import type { decodeCbor, encodeCbor } from "../cbor";
import type { decodeFlatBuffer, encodeFlatBuffer } from "../flatbuffer";
import type { ReconnectContext } from "../internal/reconnect";
import type { BoundQuery } from "../utils";
import type { Duration, RecordId, Uuid } from "../value";
import type {
    AccessRecordAuth,
    AnyAuth,
    AuthProvider,
    AuthRenewer,
    AuthResponse,
    Token,
} from "./auth";
import type { Prettify } from "./internal";
import type { LiveMessage } from "./live";
import type { EventPublisher } from "./publisher";

export type QueryResponseKind = "single" | "batched" | "batched-final";
export type ConnectionStatus = "disconnected" | "connecting" | "reconnecting" | "connected";
export type EngineFactory = (context: DriverContext) => SurrealEngine;
export type Engines = Record<string, EngineFactory>;

/**
 * The communication contract between the SDK and a SurrealDB datastore.
 *
 * @see https://github.com/surrealdb/surrealdb-protocol
 */
export interface SurrealProtocol {
    // Connection operations
    health(): Promise<void>;
    version(): Promise<VersionInfo>;

    // Session operations
    signup(auth: AccessRecordAuth): Promise<AuthResponse>;
    signin(auth: AnyAuth): Promise<AuthResponse>;
    authenticate(token: Token): Promise<void>;
    use(what: Partial<NamespaceDatabase>): Promise<NamespaceDatabase>;
    set(name: string, value: unknown): Promise<void>;
    unset(name: string): Promise<void>;
    invalidate(): Promise<void>;
    reset(): Promise<void>;

    // Data management operations
    importSql(data: string): Promise<void>;
    exportSql(options: Partial<SqlExportOptions>): Promise<string>;
    exportMlModel(options: MlExportOptions): Promise<Uint8Array>;

    // Query operations
    query<T>(query: BoundQuery, txn?: Uuid): AsyncIterable<QueryChunk<T>>;
    liveQuery(id: Uuid): AsyncIterable<LiveMessage>;
}

/**
 * An engine responsible for communicating to a SurrealDB datastore
 */
export interface SurrealEngine extends SurrealProtocol, EventPublisher<EngineEvents> {
    open(state: ConnectionState): void;
    close(): Promise<void>;
}

/**
 * The events emitted by a SurrealDB engine
 */
export type EngineEvents = {
    connecting: [];
    connected: [];
    reconnecting: [];
    disconnected: [];
    error: [Error];
};

/**
 * Options used to configure behavior of the SurrealDB driver
 */
export interface DriverOptions {
    engines?: Engines;
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
    cborEncode: typeof encodeCbor;
    cborDecode: typeof decodeCbor;
    flatBufferEncode: typeof encodeFlatBuffer;
    flatBufferDecode: typeof decodeFlatBuffer;
    uniqueId: () => string;
}

/**
 * Represents a record response
 */
export type RecordResult<T extends Record<string, unknown>> = Prettify<
    T["id"] extends RecordId ? T : { id: RecordId } & T
>;

/**
 * SurrealDB version information
 */
export interface VersionInfo {
    version: string;
}

/**
 * A combination of namespace and database
 */
export interface NamespaceDatabase {
    namespace: string | null;
    database: string | null;
}

/**
 * SurrealQL exporting options
 */
export interface SqlExportOptions {
    users: boolean;
    accesses: boolean;
    params: boolean;
    functions: boolean;
    analyzers: boolean;
    tables: boolean | string[];
    versions: boolean;
    records: boolean;
    sequences: boolean;
}

/**
 * SurrealML model exporting options
 */
export interface MlExportOptions {
    name: string;
    version: string;
}

/**
 * Query statistics
 */
export interface QueryStats {
    recordsReceived: number;
    bytesReceived: number;
    recordsScanned: number;
    bytesScanned: number;
    duration: Duration;
}

/**
 * A single chunk returned from a query stream
 */
export interface QueryChunk<T> {
    query: number;
    batch: number;
    kind: QueryResponseKind;
    stats?: QueryStats;
    result?: T[];
    error?: {
        code: number;
        message: string;
    };
}
