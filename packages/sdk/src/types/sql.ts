/**
 * The SQL dialects SurrealDB 4.0 runs over RPC, besides SurrealQL: PostgreSQL with `pgsql` and
 * MySQL with `mysql`.
 */
export type SqlDialect = "pgsql" | "mysql";

/**
 * One entry of a batch: a statement text, with variables which win over the call's own.
 */
export interface SqlBatchEntry {
    text: string;
    vars?: Record<string, unknown>;
}

/**
 * The statements of a call: a text, which may hold several `;`-separated statements, or a batch
 * of texts and entries run in order. A failing batch entry does not stop the ones after it.
 */
export type SqlStatements = string | (string | SqlBatchEntry)[];

/**
 * The options of a `pgsql()` or `mysql()` call. Every field is optional.
 */
export interface SqlOptions {
    /** Describe the last statement of each entry instead of running it */
    describe?: boolean;
    /** Rows keyed by column name (the default), or arrays in column order */
    rowMode?: "object" | "array";
    /** Values as the engine returns them (the default), or each as its text-protocol form */
    valueMode?: "native" | "text";
    /** Run every statement in one transaction, which commits only if all of them succeed */
    atomic?: boolean;
    /** The isolation level of an atomic call's transaction */
    isolation?: "snapshot" | "serializable" | (string & {});
    /** Run an atomic call's transaction read-only */
    readOnly?: boolean;
}

/**
 * The wire type of a column or parameter: `oid` for PostgreSQL, `mysql_type` for MySQL.
 */
export interface SqlType {
    name: string;
    oid?: number;
    mysql_type?: number;
}

/**
 * A column of a statement's result, in projection order.
 */
export interface SqlColumn {
    name: string;
    type: SqlType;
    /** Always null, as the server does not know */
    nullable: boolean | null;
    /** The table of a plain table column, else null */
    table: string | null;
    /** The column of a plain table column, else null */
    column: string | null;
}

/**
 * The command tag and counts of a statement which ran.
 */
export interface SqlCommand {
    /** The dialect's command tag, such as `SELECT 1` or `INSERT 0 2` for PostgreSQL */
    tag: string;
    /** The rows read or written, or null for a statement with no count */
    rows_affected: number | null;
    last_insert_id: null;
    warnings: number;
}

/**
 * The error of a statement which failed. The call itself succeeds.
 */
export interface SqlError {
    message: string;
    severity: string;
    /** The five-character SQLSTATE */
    sqlstate: string;
    /** The MySQL error number, null for PostgreSQL */
    errno: number | null;
    /** The 1-based character offset a parse error names, else null */
    position?: number | null;
}

/**
 * A statement which ran, or was described.
 */
export interface SqlStatementOk<T = unknown> {
    status: "OK";
    time?: string;
    command?: SqlCommand;
    /** Null for a described projection whose columns are known only from its rows */
    columns: SqlColumn[] | null;
    /** Absent for a described statement */
    rows?: T[];
    /** Set on the entries of an atomic call which ran, and were then rolled back */
    rolled_back?: boolean;
}

/**
 * A statement which failed, or was not run because an earlier one failed.
 */
export interface SqlStatementErr {
    status: "ERR";
    error: SqlError;
}

export type SqlStatementResult<T = unknown> = SqlStatementOk<T> | SqlStatementErr;

/**
 * The answer of a `pgsql()` or `mysql()` call, with one entry per SQL statement.
 */
export interface SqlResult<T = unknown> {
    statements: SqlStatementResult<T>[];
    /** The parameters of the last described statement, for a `describe` call only */
    params?: { type: SqlType }[];
    transaction: {
        /** Whether the session holds a transaction, and for PostgreSQL whether it has failed */
        status: "idle" | "active" | "failed";
        /** Whether an atomic call's transaction committed */
        committed?: boolean;
    };
}
