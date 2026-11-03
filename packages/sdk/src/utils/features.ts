import { Feature } from "../internal/feature";

/**
 * Available features which may be supported by specific
 * engines or versions of SurrealDB.
 */
export const Features = Object.freeze({
    LiveQueries: new Feature("live-queries"),
    Sessions: new Feature("sessions", "3.0.0"),
    Api: new Feature("api", "3.0.0"),
    RefreshTokens: new Feature("refresh-tokens", "3.0.0"),
    Transactions: new Feature("transactions", "3.0.0"),
    ExportImportRaw: new Feature("export-import-raw"),
    /** SurrealML model export, which SurrealDB 4.0 removed with SurrealML itself */
    SurrealML: new Feature("surreal-ml", undefined, "4.0.0"),
    /**
     * The engine presents credentials with each request instead of holding them in a
     * server side session, which allows credentials to be resolved or overridden per request.
     */
    PerRequestAuth: new Feature("per-request-auth"),
    /**
     * The server can answer a query with a sequence of frames, so that its first rows reach the
     * client while the rest of the query is still running. Released in 3.3.0.
     *
     * Detection is the protocol's own, as a server which cannot says so when asked, so this is
     * not consulted to decide whether to stream: it only lets a connection to a server known to
     * be older skip asking at all.
     */
    QueryStreaming: new Feature("query-streaming", "3.3.0"),
    /**
     * The `pgsql` and `mysql` RPC methods, which run PostgreSQL and MySQL text on a session.
     * Released in 4.0.0, where an instance may still deny them.
     */
    SqlDialects: new Feature("sql-dialects", "4.0.0"),
    /**
     * The `trace` option of a query, which reports the graph its statements walked: the edges,
     * references and links behind the rows, the variables a statement bound, and the live queries
     * it started. Released in 4.0.0, which refuses the option on an older server as unknown.
     */
    QueryTrace: new Feature("query-trace", "4.0.0"),
});
