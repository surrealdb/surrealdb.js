import {
    AlreadyExistsError,
    ConfigurationError,
    InternalError,
    NotAllowedError,
    NotFoundError,
    QueryError,
    SerializationError,
    ServerError,
    type ServerErrorOptions,
    ThrownError,
    ValidationError,
} from "../errors";

/**
 * Raw error object shape from the server (RPC-level errors and recursive cause).
 * Used for both top-level RPC errors and the `cause` chain.
 */
export interface RpcErrorObject {
    code: number;
    message: string;
    kind?: string;
    details?: Record<string, unknown> | string | null;
    cause?: RpcErrorObject;
}

/**
 * Raw query result error shape from the server.
 * Note: the error message is in the `result` field (not `message`).
 */
export interface RpcQueryResultErrRaw {
    status: "ERR";
    time: string;
    result: string;
    kind?: string;
    details?: Record<string, unknown> | string | null;
    cause?: RpcErrorObject;
}

/**
 * Maps legacy JSON-RPC error codes to ErrorKind values.
 * Used when `kind` is absent (old server format).
 */
const CODE_TO_KIND: Record<number, string> = {
    [-32700]: "Validation",
    [-32600]: "Validation",
    [-32601]: "NotFound",
    [-32602]: "NotAllowed",
    [-32603]: "Validation",
    [-32604]: "Configuration",
    [-32605]: "Configuration",
    [-32606]: "Configuration",
    [-32000]: "Internal",
    [-32001]: "Connection",
    [-32002]: "NotAllowed",
    [-32003]: "Query",
    [-32004]: "Query",
    [-32005]: "Query",
    [-32006]: "Thrown",
    [-32007]: "Serialization",
    [-32008]: "Serialization",
};

/**
 * Resolves the error kind from the raw server data.
 * - If `kind` is present, uses it directly.
 * - If `kind` is absent, derives it from the legacy `code`.
 * - Falls back to `"Internal"` if neither yields a known kind.
 */
function resolveKind(kind: string | undefined, code: number | undefined): string {
    if (kind) return kind;
    if (code !== undefined) return CODE_TO_KIND[code] ?? "Internal";
    return "Internal";
}

/**
 * Factory that creates the correct `ServerError` subclass based on `kind`.
 * Unknown kinds produce a plain `ServerError` instance (forward-compatible).
 */
function createServerError(options: ServerErrorOptions): ServerError {
    switch (options.kind) {
        case "Validation":
            return new ValidationError(options);
        case "Configuration":
            return new ConfigurationError(options);
        case "Thrown":
            return new ThrownError(options);
        case "Query":
            return new QueryError(options);
        case "Serialization":
            return new SerializationError(options);
        case "NotAllowed":
            return new NotAllowedError(options);
        case "NotFound":
            return new NotFoundError(options);
        case "AlreadyExists":
            return new AlreadyExistsError(options);
        case "Internal":
            return new InternalError(options);
        default:
            return new ServerError(options);
    }
}

/**
 * Parse an RPC-level error object into a `ServerError` (or subclass).
 * Handles both old format (`{ code, message }`) and new format
 * (`{ code, kind, message, details?, cause? }`).
 */
export function parseRpcError(raw: RpcErrorObject): ServerError {
    return createServerError({
        kind: resolveKind(raw.kind, raw.code),
        code: raw.code,
        message: raw.message,
        details: raw.details,
        cause: raw.cause ? parseRpcError(raw.cause) : undefined,
    });
}

/**
 * Parse a query result error into a `ServerError` (or subclass).
 * Note: query result errors use `result` as the message field and
 * have no `code` field.
 */
export function parseQueryError(raw: RpcQueryResultErrRaw): ServerError {
    return createServerError({
        kind: resolveKind(raw.kind, undefined),
        code: 0,
        message: raw.result,
        details: raw.details,
        cause: raw.cause ? parseRpcError(raw.cause) : undefined,
    });
}
