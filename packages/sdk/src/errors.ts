import type { Feature } from "./internal/feature";
import type { ApiResponse } from "./query/api";
import type { Session } from "./types";

export class SurrealError extends Error {}

/**
 * Thrown when a call has been terminated because the connection was closed
 */
export class CallTerminatedError extends SurrealError {
    override name = "CallTerminatedError";
    override message = "The call has been terminated because the connection was closed";
}

/**
 * Thrown when reconnect attempts have been exhausted
 */
export class ReconnectExhaustionError extends SurrealError {
    override name = "ReconnectExhaustionError";
    override message = "The reconnect attempts have been exhausted";
}

/**
 * Thrown when a reconnect iterator fails to iterate
 */
export class ReconnectIterationError extends SurrealError {
    override name = "ReconnectIterationError";
    override message = "The reconnect iterator failed to iterate";
}

/**
 * Thrown when an unexpected server response is received
 */
export class UnexpectedServerResponseError extends SurrealError {
    override name = "UnexpectedServerResponseError";
    readonly response: unknown;

    constructor(response: unknown) {
        super(`The server returned an unexpected response: ${JSON.stringify(response)}`);
        this.response = response;
    }
}

/**
 * Thrown when an unexpected connection error occurs
 */
export class UnexpectedConnectionError extends SurrealError {
    override name = "UnexpectedConnectionError";
    override message = "An unexpected connection error occurred";

    constructor(cause: unknown) {
        super();
        this.cause = cause;
    }
}

/**
 * Thrown when an engine is not supported
 */
export class UnsupportedEngineError extends SurrealError {
    override name = "UnsupportedEngineError";
    readonly engine: string;

    constructor(engine: string) {
        super(`The engine "${engine}" is not supported or configured`);
        this.engine = engine;
    }
}

/**
 * Thrown when there is no connection available
 */
export class ConnectionUnavailableError extends SurrealError {
    override name = "ConnectionUnavailableError";
    override message =
        "You must be connected to a SurrealDB instance before performing this operation";
}

/**
 * Thrown when there is no namespace and/or database selected
 */
export class MissingNamespaceDatabaseError extends SurrealError {
    override name = "MissingNamespaceDatabaseError";
    override message = "There is no namespace and/or database selected";
}

/**
 * Thrown when a connection to the server fails
 */
export class HttpConnectionError extends SurrealError {
    override name = "HttpConnectionError";

    readonly status: number;
    readonly statusText: string;
    readonly buffer: ArrayBuffer;

    constructor(message: string, status: number, statusText: string, buffer: ArrayBuffer) {
        super(`HTTP connection failed: ${message}`);
        this.status = status;
        this.statusText = statusText;
        this.buffer = buffer;
    }
}

// =========================================================== //
//                                                             //
//                   Server Error Hierarchy                     //
//                                                             //
// =========================================================== //

/**
 * Known error kinds returned by the SurrealDB server.
 * Use these constants for matching against `ServerError.kind`.
 */
export const ErrorKind = {
    Validation: "Validation",
    Configuration: "Configuration",
    Thrown: "Thrown",
    Query: "Query",
    Serialization: "Serialization",
    NotAllowed: "NotAllowed",
    NotFound: "NotFound",
    AlreadyExists: "AlreadyExists",
    Connection: "Connection",
    Internal: "Internal",
} as const;

/**
 * Union type of all known error kinds. The `kind` property on `ServerError`
 * is typed as `string` (not `ErrorKind`) to allow unknown kinds from newer
 * servers to pass through without loss.
 */
export type ErrorKind = (typeof ErrorKind)[keyof typeof ErrorKind];

export interface ServerErrorOptions {
    kind: string;
    code?: number;
    message: string;
    details?: Record<string, unknown> | string | null;
    cause?: ServerError;
}

/**
 * Checks if the given value exists under `key` in a details object.
 * Handles both serde externally-tagged enum formats:
 * - Unit variants: `"VariantName"` (top-level string)
 * - Struct/newtype variants: `{ "VariantName": ... }` (object key)
 */
function hasDetailKey(details: Record<string, unknown> | string | null | undefined, key: string): boolean {
    if (details == null) return false;
    if (typeof details === "string") return details === key;
    return key in details;
}

/**
 * Gets the value under `key` from a details object.
 * Returns `undefined` if the key is not present or details is a string/null.
 */
function getDetailValue(details: Record<string, unknown> | string | null | undefined, key: string): unknown {
    if (details == null || typeof details !== "object") return undefined;
    return details[key];
}

/**
 * Checks if a serde variant matches a given key, handling both serialization forms:
 * - String: `"VariantName"` (unit variant)
 * - Object: `{ "VariantName": ... }` (struct/newtype variant, possibly empty `{}`)
 */
function matchesVariant(value: unknown, key: string): boolean {
    if (value === key) return true;
    if (value && typeof value === "object" && value !== null && key in value) return true;
    return false;
}

/**
 * Base class for all errors originating from the SurrealDB server.
 * Replaces the former `ResponseError` class.
 *
 * Server errors carry structured information:
 * - `kind` — the error category (e.g. `"NotAllowed"`, `"NotFound"`)
 * - `code` — legacy JSON-RPC numeric error code (0 when unavailable)
 * - `details` — kind-specific structured details from the server
 * - `cause` — the underlying server error, if any (recursive chain)
 *
 * Use `instanceof` on subclasses (e.g. `NotFoundError`, `NotAllowedError`)
 * for type-safe matching, or check the `kind` property directly.
 */
export class ServerError extends SurrealError {
    override get name(): string {
        return `ServerError [${this.kind}]`;
    }

    /** The structured error kind (e.g. "NotAllowed", "NotFound", "Internal") */
    readonly kind: string;

    /** Legacy JSON-RPC error code. 0 when not available (e.g. query result errors). */
    readonly code: number;

    /** Kind-specific structured details. `undefined` when not provided by the server. */
    readonly details: Record<string, unknown> | string | undefined;

    /** The underlying cause error from the server, if any. */
    override readonly cause: ServerError | undefined;

    constructor(options: ServerErrorOptions) {
        super(options.message);
        this.kind = options.kind;
        this.code = options.code ?? 0;
        this.details = options.details ?? undefined;
        this.cause = options.cause;
    }

    /**
     * Check if this error or any error in the cause chain matches the given kind.
     */
    hasKind(kind: string): boolean {
        if (this.kind === kind) return true;
        return this.cause?.hasKind(kind) ?? false;
    }

    /**
     * Find the first error in the cause chain (including this error) that
     * matches the given kind.
     */
    findCause(kind: string): ServerError | undefined {
        if (this.kind === kind) return this;
        return this.cause?.findCause(kind);
    }
}

/**
 * Server error: validation failure (parse error, invalid request/params, bad input).
 */
export class ValidationError extends ServerError {
    override readonly kind = "Validation" as const;
    override get name() { return "ValidationError"; }

    /** True if this is a SurrealQL parse error. */
    get isParseError(): boolean {
        return hasDetailKey(this.details, "Parse");
    }

    /** The name of the invalid parameter, if applicable. */
    get parameterName(): string | undefined {
        const v = getDetailValue(this.details, "InvalidParameter");
        return v && typeof v === "object" && v !== null && "name" in v
            ? String((v as { name: string }).name)
            : undefined;
    }
}

/**
 * Server error: feature or configuration not supported (live queries, GraphQL).
 */
export class ConfigurationError extends ServerError {
    override readonly kind = "Configuration" as const;
    override get name() { return "ConfigurationError"; }

    /** True if live queries are not supported by the server configuration. */
    get isLiveQueryNotSupported(): boolean {
        return hasDetailKey(this.details, "LiveQueryNotSupported");
    }
}

/**
 * Server error: user-thrown error via THROW in SurrealQL.
 */
export class ThrownError extends ServerError {
    override readonly kind = "Thrown" as const;
    override get name() { return "ThrownError"; }
}

/**
 * Server error: query execution failure (timeout, cancelled, not executed).
 */
export class QueryError extends ServerError {
    override readonly kind = "Query" as const;
    override get name() { return "QueryError"; }

    /** True if the query was not executed (e.g. due to a prior error in the batch). */
    get isNotExecuted(): boolean {
        return hasDetailKey(this.details, "NotExecuted");
    }

    /** True if the query timed out. */
    get isTimedOut(): boolean {
        return hasDetailKey(this.details, "TimedOut");
    }

    /** True if the query was cancelled. */
    get isCancelled(): boolean {
        return hasDetailKey(this.details, "Cancelled");
    }

    /** The timeout duration, if this is a timeout error. Returns `{ secs, nanos }` or undefined. */
    get timeout(): { secs: number; nanos: number } | undefined {
        const v = getDetailValue(this.details, "TimedOut");
        if (v && typeof v === "object" && v !== null && "duration" in v) {
            return (v as { duration: { secs: number; nanos: number } }).duration;
        }
        return undefined;
    }
}

/**
 * Server error: serialization or deserialization failure.
 */
export class SerializationError extends ServerError {
    override readonly kind = "Serialization" as const;
    override get name() { return "SerializationError"; }

    /** True if this is a deserialization error (as opposed to serialization). */
    get isDeserialization(): boolean {
        return hasDetailKey(this.details, "Deserialization");
    }
}

/**
 * Server error: permission denied, method not allowed, function/scripting blocked.
 */
export class NotAllowedError extends ServerError {
    override readonly kind = "NotAllowed" as const;
    override get name() { return "NotAllowedError"; }

    /** True if the auth token has expired. */
    get isTokenExpired(): boolean {
        const auth = getDetailValue(this.details, "Auth");
        return matchesVariant(auth, "TokenExpired");
    }

    /** True if authentication credentials are invalid. */
    get isInvalidAuth(): boolean {
        const auth = getDetailValue(this.details, "Auth");
        return matchesVariant(auth, "InvalidAuth");
    }

    /** True if scripting is blocked. */
    get isScriptingBlocked(): boolean {
        return hasDetailKey(this.details, "Scripting");
    }

    /** The method name that is not allowed, if applicable. */
    get methodName(): string | undefined {
        const v = getDetailValue(this.details, "Method");
        return v && typeof v === "object" && v !== null && "name" in v
            ? String((v as { name: string }).name)
            : undefined;
    }

    /** The function name that is not allowed, if applicable. */
    get functionName(): string | undefined {
        const v = getDetailValue(this.details, "Function");
        return v && typeof v === "object" && v !== null && "name" in v
            ? String((v as { name: string }).name)
            : undefined;
    }
}

/**
 * Server error: resource not found (table, record, namespace, method, etc.).
 */
export class NotFoundError extends ServerError {
    override readonly kind = "NotFound" as const;
    override get name() { return "NotFoundError"; }

    /** The table name that was not found, if applicable. */
    get tableName(): string | undefined {
        const v = getDetailValue(this.details, "Table");
        return v && typeof v === "object" && v !== null && "name" in v
            ? String((v as { name: string }).name)
            : undefined;
    }

    /** The record ID that was not found, if applicable. */
    get recordId(): string | undefined {
        const v = getDetailValue(this.details, "Record");
        return v && typeof v === "object" && v !== null && "id" in v
            ? String((v as { id: string }).id)
            : undefined;
    }

    /** The RPC method name that was not found, if applicable. */
    get methodName(): string | undefined {
        const v = getDetailValue(this.details, "Method");
        return v && typeof v === "object" && v !== null && "name" in v
            ? String((v as { name: string }).name)
            : undefined;
    }

    /** The namespace name that was not found, if applicable. */
    get namespaceName(): string | undefined {
        const v = getDetailValue(this.details, "Namespace");
        return v && typeof v === "object" && v !== null && "name" in v
            ? String((v as { name: string }).name)
            : undefined;
    }

    /** The database name that was not found, if applicable. */
    get databaseName(): string | undefined {
        const v = getDetailValue(this.details, "Database");
        return v && typeof v === "object" && v !== null && "name" in v
            ? String((v as { name: string }).name)
            : undefined;
    }
}

/**
 * Server error: duplicate resource (record, table, namespace, etc.).
 */
export class AlreadyExistsError extends ServerError {
    override readonly kind = "AlreadyExists" as const;
    override get name() { return "AlreadyExistsError"; }

    /** The record ID that already exists, if applicable. */
    get recordId(): string | undefined {
        const v = getDetailValue(this.details, "Record");
        return v && typeof v === "object" && v !== null && "id" in v
            ? String((v as { id: string }).id)
            : undefined;
    }

    /** The table name that already exists, if applicable. */
    get tableName(): string | undefined {
        const v = getDetailValue(this.details, "Table");
        return v && typeof v === "object" && v !== null && "name" in v
            ? String((v as { name: string }).name)
            : undefined;
    }
}

/**
 * Server error: unexpected or unknown internal error.
 * Also used as the fallback for unrecognized `kind` strings from newer servers.
 */
export class InternalError extends ServerError {
    override readonly kind = "Internal" as const;
    override get name() { return "InternalError"; }
}

/**
 * @deprecated Use `ServerError` instead. This alias exists for backward compatibility.
 */
export const ResponseError = ServerError;

/**
 * Thrown when authentication fails
 */
export class AuthenticationError extends SurrealError {
    override name = "AuthenticationError";
    override message = "Authentication did not succeed";

    constructor(cause: unknown) {
        super();
        this.cause = cause;
    }
}

/**
 * Thrown when a live subscription fails to listen
 */
export class LiveSubscriptionError extends SurrealError {
    override name = "LiveSubscriptionError";

    constructor(messageOrCause?: string | unknown) {
        if (typeof messageOrCause === "string") {
            super(messageOrCause);
        } else {
            super("Live subscription failed to listen");
            this.cause = messageOrCause;
        }
    }
}

/**
 * Thrown when the version of the remote datastore is not supported
 */
export class UnsupportedVersionError extends SurrealError {
    override name = "UnsupportedVersionError";

    readonly version: string;
    readonly minimum: string;
    readonly maximum: string;

    constructor(version: string, minimum: string, maximum: string) {
        super(
            `The version "${version}" reported by the engine is not supported by this library, expected a version that satisfies >= ${minimum} < ${maximum}`,
        );
        this.version = version;
        this.minimum = minimum;
        this.maximum = maximum;
    }
}

/**
 * Thrown when a SurrealQL expression fails to compute
 */
export class ExpressionError extends SurrealError {
    override name = "ExpressionError";

    constructor(messageOrCause?: string | unknown) {
        if (typeof messageOrCause === "string") {
            super(messageOrCause);
        } else {
            super("Failed to parse invalid expression");
            this.cause = messageOrCause;
        }
    }
}

/**
 * Thrown when one or more subscribers throw an error
 */
export class PublishError extends SurrealError {
    override name = "PublishError";
    override message = "One or more subscribers threw an error:";

    readonly causes: unknown[];

    constructor(causes: unknown[]) {
        super();
        this.causes = causes;
        this.message += PublishError.#appendCauses(causes, "");
    }

    static #appendCauses(causes: unknown[], msg: string): string {
        let message = msg;

        for (const cause of causes) {
            if (cause instanceof PublishError) {
                message = PublishError.#appendCauses(cause.causes, msg);
            } else {
                message += `\n  - ${cause instanceof Error ? cause.message : cause}`;
            }
        }

        return message;
    }
}

/**
 * Thrown when a parsed date or datetime is invalid
 */
export class InvalidDateError extends SurrealError {
    override name = "InvalidDateError";

    constructor(dateOrMessage: Date | string) {
        if (typeof dateOrMessage === "string") {
            super(dateOrMessage);
        } else {
            super(`The provided date is invalid: ${dateOrMessage}`);
        }
    }
}

/**
 * Thrown when a feature is not supported by the current engine
 */
export class UnsupportedFeatureError extends SurrealError {
    override name = "UnsupportedFeatureError";

    readonly feature: Feature;

    constructor(feature: Feature) {
        super(`The configured engine does not support the feature: ${feature.name}`);
        this.feature = feature;
    }
}

/**
 * Thrown when a feature is not available in the used version of SurrealDB
 */
export class UnavailableFeatureError extends SurrealError {
    override name = "UnavailableFeatureError";

    readonly feature: Feature;
    readonly version: string;

    constructor(feature: Feature, version: string) {
        super(
            `The version of SurrealDB (${version}) does not support the feature: ${feature.name} (>= ${feature.sinceVersion} < ${feature.untilVersion})`,
        );
        this.feature = feature;
        this.version = version;
    }
}

/**
 * Thrown when a session is invalid
 */
export class InvalidSessionError extends SurrealError {
    override name = "InvalidSessionError";
    override message = "The provided session is invalid";

    readonly session: Session;

    constructor(session: Session) {
        super(`Invalid session: ${session}`);
        this.session = session;
    }
}

/**
 * Thrown when an API request was unsuccessful
 */
export class UnsuccessfulApiError extends SurrealError {
    override name = "UnsuccessfulApiError";

    readonly path: string;
    readonly method: string;
    readonly response: ApiResponse<unknown>;

    constructor(path: string, method: string, response: ApiResponse<unknown>) {
        super(`The ${method.toUpperCase()} ${path} request failed with status ${response.status}`);
        this.path = path;
        this.method = method;
        this.response = response;
    }
}

// =========================================================== //
//                                                             //
//                   Value Validation Errors                    //
//                                                             //
// =========================================================== //

/**
 * Thrown when a RecordId or RecordIdRange is constructed with invalid parts
 */
export class InvalidRecordIdError extends SurrealError {
    override name = "InvalidRecordIdError";

    constructor(message: string) {
        super(message);
    }
}

/**
 * Thrown when a Duration string cannot be parsed or a duration operation is invalid
 */
export class InvalidDurationError extends SurrealError {
    override name = "InvalidDurationError";

    constructor(message: string) {
        super(message);
    }
}

/**
 * Thrown when a Decimal operation fails (division by zero, invalid input, etc.)
 */
export class InvalidDecimalError extends SurrealError {
    override name = "InvalidDecimalError";

    constructor(message: string) {
        super(message);
    }
}

/**
 * Thrown when a Table or StringRecordId is constructed with an invalid value
 */
export class InvalidTableError extends SurrealError {
    override name = "InvalidTableError";

    constructor(message: string) {
        super(message);
    }
}
