import type {
    CodecOptions,
    Duration,
    RecordId,
    RecordIdValue,
    Uuid,
    ValueCodec,
} from "@surrealdb/sqon";
import type { ServerError } from "../errors";
import type { Feature } from "../internal/feature";
import type { ReconnectContext } from "../internal/reconnect";
import type { BoundQuery } from "../utils";
import type { AccessRecordAuth, AnyAuth, AuthOrToken, AuthProvider, Token, Tokens } from "./auth";
import type { Nullable } from "./helpers";
import type { Prettify } from "./internal";
import type { LiveMessage } from "./live";
import type { EventPublisher } from "./publisher";

export type Session = Uuid | undefined;
export type QueryResponseKind = "single" | "batched" | "batched-final";
export type ConnectionStatus = "disconnected" | "connecting" | "reconnecting" | "connected";
export type EngineFactory = (context: DriverContext) => SurrealEngine;
export type Codecs = { [K in keyof CodecRegistry]?: (options: CodecOptions) => CodecRegistry[K] };
export type Engines = Record<string, EngineFactory>;
export type DataStream = string | ReadableStream;
export type QueryType = "live" | "kill" | "other";
export type RetryValue = boolean | Partial<RetryOptions>;

/**
 * The registry of codecs supported by the SDK.
 */
export interface CodecRegistry {
    cbor: ValueCodec<Uint8Array>;
    flatbuffer: ValueCodec<Uint8Array>;
    json: ValueCodec<unknown>;
}

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
    attach(session: Uuid): Promise<void>;
    detach(session: Uuid): Promise<void>;

    // Session operations
    use(what: Nullable<NamespaceDatabase>, session: Session): Promise<NamespaceDatabase>;
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
    importSql(data: string | Blob | ReadableStream): Promise<void>;
    exportSql(options: Partial<SqlExportOptions>): Promise<Response | string>;
    exportMlModel(options: MlExportOptions): Promise<Response | Uint8Array>;

    // Query operations
    query<T>(
        query: BoundQuery,
        session: Session,
        txn?: Uuid,
        options?: RequestOptions,
    ): AsyncIterable<QueryChunk<T>>;
    gql<T>(
        query: BoundQuery,
        session: Session,
        txn?: Uuid,
        options?: RequestOptions,
    ): AsyncIterable<QueryChunk<T>>;
    liveQuery(id: Uuid): AsyncIterable<LiveMessage>;
}

/**
 * Options for a single request made to an engine
 */
export interface RequestOptions {
    /**
     * Abandon the request when this signal aborts.
     *
     * An engine honouring it stops waiting for the answer, releases what the request holds,
     * and fails with the reason of the signal. Whether the server also stops executing is up
     * to the protocol: where it has no way of being told, it carries on and the answer is
     * discarded on arrival.
     *
     * Engines are free to ignore it. The SDK stops waiting on its own either way, so an
     * engine which does only misses the chance to release resources early.
     */
    signal?: AbortSignal;
}

/**
 * An engine responsible for communicating to a SurrealDB datastore
 */
export interface SurrealEngine extends SurrealProtocol, EventPublisher<EngineEvents> {
    features: Set<Feature>;
    open(state: ConnectionState): void;
    close(): Promise<void>;
    ready(): void;

    /**
     * Run a query as a different identity than the one of the session, for this query only.
     * The session is neither used for authentication nor changed.
     *
     * Only implemented by engines which present credentials with every request, and which
     * declare `Features.PerRequestAuth`. A query which is to run as someone else is never
     * run through `query()`, so an engine, or something wrapping one, which does not implement
     * this method refuses the query rather than running it as the session.
     *
     * @param credential An access token, or authentication details which are exchanged for one
     */
    queryAs?<T>(
        query: BoundQuery,
        session: Session,
        txn: Uuid | undefined,
        credential: AuthOrToken,
    ): AsyncIterable<QueryChunk<T>>;
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
    /**
     * Extra options merged into the `init` of every request the HTTP engine makes with `fetch`,
     * such as `cache`, `priority`, `credentials` or `keepalive`.
     *
     * Unlike `fetchImpl`, which replaces `fetch` altogether, these only add to the request. The
     * `method`, `headers`, `body` and `signal` of a request belong to the SDK and cannot be set.
     */
    fetchOptions?: FetchOptions;
    /**
     * Stream query results from the server as they are produced, instead of receiving
     * them in a single response, on engines and servers which support it.
     *
     * Streaming lowers the time until the first result and avoids decoding one large
     * response, and is transparent: results, errors, and statistics are the same either
     * way. Queries sent inside a transaction created with `.begin()` are never streamed,
     * and a server without support for streaming is detected and used as before.
     *
     * @default true
     */
    streaming?: boolean;
}

/**
 * Options which can be merged into the `init` of a `fetch` request made by the SDK
 */
export type FetchOptions = Omit<RequestInit, "method" | "headers" | "body" | "signal">;

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
     * Authentication details to use when connecting, or a function computing them. The details
     * may be a token, or anything accepted by `.signin()`: a system user, record access
     * `variables`, a bearer access `key`, or a system user signing in through an `access` method.
     * Unlike when using the `.signin()` method, the provided authentication details may be used
     * for all sessions and will be reused when a session expires.
     *
     * When a callback is specified returning a Promise, the SDK will wait with signaling the connection as connected
     * until the Promise is resolved. If the callback throws, or returns something unusable, the
     * connection fails with an `AuthResolverError`.
     *
     * When `.signin()`, `.signup()`, or `.authenticate()` is used this property will be ignored for the duration of the session.
     *
     * To evaluate the function as requests are made instead, so that a token which is rotated
     * out of band is picked up, or because the connection is not long lived, pass a resolver
     * with `when: "request"`. The credential is then reused until shortly before it expires,
     * as governed by `cache` and `expiryMargin`, and resolved again after that. No timers are
     * scheduled, and nothing is resolved when connecting.
     *
     * Over HTTP the credential is sent as the `Authorization` header of the request. Over
     * WebSocket the session is authenticated again whenever the credential changes, before the
     * request is sent. The credential belongs to the session, so requests which need different
     * identities must use `.as()` (HTTP) or separate sessions (WebSocket).
     *
     * @example
     * ```ts
     * await db.connect("https://example.surrealdb.com", {
     *     namespace: "app",
     *     database: "app",
     *     authentication: {
     *         resolve: async () => await fetchTokenFromIdentityProvider(),
     *         when: "request",
     *         cache: "until-expiry",
     *     },
     * });
     * ```
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
     * This does not apply to credentials which are resolved for each request, as those are
     * not renewed in the background. They are resolved again by the request which needs them.
     *
     * @default false
     */
    invalidateOnExpiry?: boolean;
    /**
     * The amount of time in seconds before the expected expiry of the session token to attempt
     * a renewal or invalidation of the session. When the session duration is shorter than the
     * expiry margin, the margin is skipped and the token expiry is used as the delay.
     *
     * For credentials which are resolved for each request, it is how long before the expiry of
     * a token it stops being reused.
     *
     * @default 60
     */
    expiryMargin?: number;
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
    /**
     * Configure the default retry behavior used to automatically replay work that fails due
     * to a transaction conflict under concurrent load.
     *
     * This default is used by the `transaction()` helper and by queries marked with `.retry()`.
     * It is disabled by default; auto-retrying must be opted into explicitly because replaying
     * a non-atomic, multi-statement query could apply some statements more than once.
     *
     * - When set to `false` (the default), no work is retried automatically.
     * - When set to `true`, retry is enabled using default options.
     * - When set to an object, retry is enabled using the provided options.
     *
     * @remarks
     * Automatic retry is supported by this SDK from **v2.1.0**. Conflict detection relies on
     * the structured `TransactionConflict` error introduced in **SurrealDB 3.1.0**; against
     * older servers, supply a custom {@link RetryOptions.retryable} predicate.
     *
     * @default false
     */
    retry?: boolean | Partial<RetryOptions>;
    /**
     * The longest, in milliseconds, to wait for the answer to a query before giving up on it.
     *
     * This is a client side limit: it stops the SDK from waiting, and nothing more. The server is
     * not told, and may well carry on and apply a write the SDK has stopped waiting for. To have
     * the server stop a query itself, use the `TIMEOUT` clause, which the query builders expose as
     * `.timeout()`.
     *
     * A query which exceeds the limit fails with the `TimeoutError` `DOMException` of
     * `AbortSignal.timeout()`, so that it can be told apart from an abort requested through a
     * signal, which fails with the reason of that signal.
     *
     * The limit applies to each request separately, so a query retried after a transaction
     * conflict gets a fresh one for every attempt, and to queries only, which includes a list of
     * queries and an atomic `transaction()`: it does not apply to signing in, selecting a
     * namespace, the `begin` and `commit` of an interactive transaction, import or export. It starts when
     * the request is sent, and does not include waiting for a connection to be established. To
     * bound the whole of an operation, including retries and connection waits, pass
     * `AbortSignal.timeout()` to `.signal()` instead.
     *
     * A query can override the limit with `.requestTimeout()`, which is the only way to allow
     * one longer than the default. `0` disables it.
     *
     * @default 0 (no limit)
     */
    requestTimeout?: number;
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
 * Options to configure automatic retry behavior for transaction conflicts.
 *
 * @remarks
 * Supported by this SDK from **v2.1.0**. By default, retries are triggered only by the
 * structured `TransactionConflict` error emitted by **SurrealDB 3.1.0 and later**. To
 * customize what counts as retryable (for example, to support older servers), provide a
 * {@link RetryOptions.retryable} predicate.
 */
export interface RetryOptions {
    /** Whether retry is enabled. When `false`, work is executed once and conflicts are surfaced as-is */
    enabled: boolean;
    /** How many attempts will be made at retrying, -1 for unlimited */
    attempts: number;
    /** The minimum amount of time in milliseconds to wait before retrying */
    retryDelay: number;
    /** The maximum amount of time in milliseconds to wait before retrying */
    retryDelayMax: number;
    /** The amount to multiply the delay by after each failed attempt */
    retryDelayMultiplier: number;
    /** A float percentage to randomly offset each delay by */
    retryDelayJitter: number;
    /**
     * Decide whether a caught error should trigger a retry.
     *
     * Defaults to {@link isRetryableConflict}, which matches the structured
     * `TransactionConflict` error emitted by SurrealDB 3.1.0+. Provide your own predicate to
     * override or extend this — for example, to retry on additional error kinds, or to detect
     * conflicts reported by an older server that does not emit the structured error.
     *
     * The predicate receives the thrown error and returns `true` to retry it. It fully
     * replaces the default check when provided.
     *
     * @example Match conflicts by message (e.g. for servers older than 3.1.0)
     * ```ts
     * const db = new Surreal({
     *     retry: {
     *         retryable: (error) => {
     *             if (!(error instanceof ServerError)) return false;
     *             const message = error.message.toLowerCase();
     *             return message.includes("conflict") || message.includes("can be retried");
     *         },
     *     },
     * });
     * ```
     */
    retryable?: (error: unknown) => boolean;
}

/**
 * Options to configure a stateless, atomic `transaction()`.
 */
export interface TransactionOptions {
    /**
     * Replay the whole transaction when it fails due to a transaction conflict.
     *
     * Defaults to the `retry` behavior configured on the connection. The queries passed to
     * `transaction()` are sent as one atomic request, so replaying them is always safe.
     *
     * As for any retry, a conflict is only recognized by default when the server reports it as a
     * structured `TransactionConflict`, which SurrealDB 3.1.0 and later do. For earlier versions
     * give a `retryable` predicate, which is passed the error which made the transaction fail.
     */
    retry?: RetryValue;
    /**
     * Abandon the transaction when this signal aborts.
     *
     * If the signal has already aborted, nothing is sent. If it aborts later, the transaction stops
     * waiting for the server and fails with the `reason` of the signal, as it is, and a transaction
     * waiting to be retried is not retried again. Combined with the signal of the view it is called
     * on, if it was made with `withSignal()`: the transaction is abandoned when either aborts.
     *
     * Aborting means "stop waiting", and nothing more. The transaction was sent as a single request,
     * which the server may well carry on to run, and **it may or may not have been committed**.
     */
    signal?: AbortSignal;
    /**
     * How long to wait for the server to answer, in milliseconds, before giving up with a
     * `TimeoutError`, as for `requestTimeout` of the connection, which is the default. `0` waits
     * without limit.
     *
     * It applies to each attempt, so a transaction which is retried gets the full time for every
     * attempt. As for a signal, the transaction may or may not have been committed when it expires.
     */
    requestTimeout?: number;
}

/**
 * A query builder, such as the one returned by `select()`, `create()`, `update()`,
 * `upsert()`, `delete()`, `insert()`, `relate()`, `run()`, `auth()` or `api()`, which can
 * be compiled into the {@link BoundQuery} it would send.
 */
export interface CompilableQuery {
    compile(): BoundQuery;
}

/**
 * A query which exposes the {@link BoundQuery} it will send as `inner`, such as the `Query`
 * returned by `query()`.
 */
export interface InnerQuery {
    readonly inner: BoundQuery;
}

/**
 * Anything which can be combined with other queries by `query([...])` or `transaction([...])`.
 *
 * - A `string` of SurrealQL, which carries no bindings
 * - A {@link BoundQuery}, such as one created by the `surql` template tag
 * - A query builder, which contributes the statement it compiles to
 * - A `Query` returned by `query()`, which contributes its inner query
 *
 * Only the statements and their bindings are taken from an input. Anything configured on a
 * builder or `Query` itself, such as `.json()`, `.retry()`, `.signal()` or `.requestTimeout()`, is
 * ignored in favor of the combined query's own configuration: to abandon the combined query, call
 * `.signal()` on it, or call `query()` on a view made with `withSignal()`.
 */
export type QueryLike = string | BoundQuery | CompilableQuery | InnerQuery;

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
    retry: RetryOptions;
    requestTimeout?: number;
    rootSession: ConnectionSession;
    sessions: Map<Uuid, ConnectionSession>;
    /**
     * Supplies the credential to present for each request, for engines which present
     * credentials with every request. Only set when the connection resolves credentials
     * per request.
     */
    credentials?: CredentialSource;
}

/**
 * Supplies the credential an engine presents with a request.
 */
export interface CredentialSource {
    /**
     * Resolve the token to present for a request on a session. Resolves to undefined when
     * the request is to be made without credentials.
     *
     * @param session The session the request is made on
     * @param rejected A token which the server has just refused, which is not handed out again
     */
    token(session: Session, rejected?: Token): Promise<Token | undefined>;
}

export type { CodecOptions, ValueCodec };

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
    apis: boolean;
    buckets: boolean;
    modules: boolean;
    configs: boolean;
    tables: boolean | string[];
    versions: boolean;
    records: boolean;
    sequences: boolean;
    v3: boolean;
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
    error?: ServerError;
}

/**
 * A single successful response from a query
 */
export type QueryResponseSuccess<T = unknown> = {
    success: true;
    stats?: QueryStats;
    type: "live" | "kill" | "other";
    result: T;
};

/**
 * A single failure response from a query
 */
export type QueryResponseFailure = {
    success: false;
    stats?: QueryStats;
    error: ServerError;
};

/**
 * A single response from a query
 */
export type QueryResponse<T = unknown> = QueryResponseSuccess<T> | QueryResponseFailure;
