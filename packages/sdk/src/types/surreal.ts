import type { Feature } from "../internal/feature";
import type { ReconnectContext } from "../internal/reconnect";
import type { BoundQuery } from "../utils";
import type { Duration, RecordId, RecordIdValue, Uuid } from "../value";
import type { AccessRecordAuth, AnyAuth, AuthProvider, Token, Tokens } from "./auth";
import type { Nullable } from "./helpers";
import type { Prettify } from "./internal";
import type { LiveMessage } from "./live";
import type { EventPublisher } from "./publisher";

export type Session = Uuid | undefined;
export type CodecType = "cbor" | "flatbuffer" | (string & {});
export type QueryResponseKind = "single" | "batched" | "batched-final";
export type ConnectionStatus = "disconnected" | "connecting" | "reconnecting" | "connected";
export type EngineFactory = (context: DriverContext) => SurrealEngine;
export type Engines = Record<string, EngineFactory>;
export type CodecFactory = (options: CodecOptions) => ValueCodec;
export type Codecs = Partial<Record<CodecType, CodecFactory>>;
export type CodecRegistry = Record<CodecType, ValueCodec>;
export type QueryType = "live" | "kill" | "other";

/**
 * The communication contract between the SDK and a SurrealDB datastore.
 *
 * @see https://github.com/surrealdb/surrealdb-protocol
 */
export interface SurrealProtocol {
	// Connection operations
	health(): Promise<void>;
	version(): Promise<VersionInfo>;
	sessions(): Promise<Uuid[]>;

	// Session operations
	use(what: Nullable<NamespaceDatabase>, session: Session): Promise<void>;
	signup(auth: AccessRecordAuth, session: Session): Promise<Tokens>;
	signin(auth: AnyAuth, session: Session): Promise<Tokens>;
	authenticate(token: Token, session: Session): Promise<void>;
	set(name: string, value: unknown, session: Session): Promise<void>;
	unset(name: string, session: Session): Promise<void>;
	refresh(tokens: Tokens, session: Session): Promise<Tokens>;
	revoke(tokens: Tokens, session: Session): Promise<void>;
	invalidate(session: Session): Promise<void>;
	reset(session: Session): Promise<void>;

	// Transaction operations
	begin(session: Session): Promise<Uuid>;
	commit(txn: Uuid, session: Session): Promise<void>;
	cancel(txn: Uuid, session: Session): Promise<void>;

	// Data management operations
	importSql(data: string): Promise<void>;
	exportSql(options: Partial<SqlExportOptions>): Promise<string>;
	exportMlModel(options: MlExportOptions): Promise<Uint8Array>;

	// Query operations
	query<T>(query: BoundQuery, session: Session, txn?: Uuid): AsyncIterable<QueryChunk<T>>;
	liveQuery(id: Uuid): AsyncIterable<LiveMessage>;
}

/**
 * An engine responsible for communicating to a SurrealDB datastore
 */
export interface SurrealEngine extends SurrealProtocol, EventPublisher<EngineEvents> {
	features: Set<Feature>;
	open(state: ConnectionState): void;
	close(): Promise<void>;
}

/**
 * The events emitted by a SurrealDB engine
 */
export type EngineEvents = {
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
	codecs?: Codecs;
	codecOptions?: CodecOptions;
	websocketImpl?: typeof WebSocket;
	fetchImpl?: typeof fetch;
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
	 * Authentication details to use when connecting as a system user or with a token. You can provide a static value,
	 * or a function which is called to compute the authentication details. Unlike when using the `.signin()` method,
	 * the provided authentication details may be used for all sessions and will be reused when a session expires.
	 *
	 * When a callback is specified returning a Promise, the SDK will wait with signaling the connection as connected
	 * until the Promise is resolved.
	 *
	 * When `.signin()`, `.signup()`, or `.authenticate()` is used this property will be ignored for the duration of the session.
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
	 * Automatically invalidate sessions when the access token expires.
	 *
	 * When set to `false` (the default), the driver will attempt to renew the session through a
	 * series of steps:
	 *
	 * 1. Attempt to reuse the previous access token
	 * 2. Attempt to issue a new access token using the refresh token
	 * 3. Attempt to invoke the authentication provider
	 *
	 * If none of these steps succeed, the session will be invalidated regardless.
	 *
	 * @default false
	 */
	invalidateOnExpiry?: boolean;
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

export interface ConnectionSession {
	id: Session;
	namespace: string | undefined;
	database: string | undefined;
	accessToken: string | undefined;
	refreshToken: string | undefined;
	variables: Record<string, unknown>;
	authRenewal: ReturnType<typeof setTimeout> | undefined;
	authOverriden: boolean;
}

/**
 * The current state of a connection to a SurrealDB datastore
 */
export interface ConnectionState {
	url: URL;
	reconnect: ReconnectContext;
	rootSession: ConnectionSession;
	sessions: Map<Uuid, ConnectionSession>;
}

/**
 * Options used to configure the value codec
 */
export interface CodecOptions {
	/** Use native `Date` objects instead of custom `DateTime` objects. Using `Date` objects will result in a loss of nanosecond precision. */
	useNativeDates?: boolean;
	/** Specify a custom visitor function to process encode values. */
	valueEncodeVisitor?: (value: unknown) => unknown;
	/** Specify a custom visitor function to process decode values. */
	valueDecodeVisitor?: (value: unknown) => unknown;
}

/**
 * A codec for encoding and decoding SurrealQL values
 */
export interface ValueCodec {
	encode: <T>(data: T) => Uint8Array;
	decode: <T>(data: Uint8Array) => T;
}

/**
 * Context information passed to each controller and engine
 */
export interface DriverContext {
	options: DriverOptions;
	uniqueId: () => string;
	codecs: CodecRegistry;
}

/**
 * Represents a record response
 */
export type RecordResult<T> = Prettify<
	T extends object
	? T extends { id: infer Id }
	? Id extends RecordId
	? T
	: Id extends RecordIdValue
	? { id: RecordId<string, Id> } & Omit<T, "id">
	: { id: RecordId } & Omit<T, "id">
	: { id: RecordId } & T
	: { id: RecordId }
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
	namespace?: string;
	database?: string;
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
	type?: QueryType;
	error?: {
		code: number;
		message: string;
	};
}

/**
 * A single response from a query
 */
export type QueryResponse<T = unknown> = {
	success: true;
	stats?: QueryStats;
	type: "live" | "kill" | "other";
	result: T;
} | {
	success: false;
	stats?: QueryStats;
	error: {
		code: number;
		message: string;
	};
}