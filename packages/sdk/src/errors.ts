import type { RpcErrorResponse } from "./types";

export class SurrealError extends Error {}

/**
 * Thrown when an operation depends on an active connection
 */
export class NoActiveConnection extends SurrealError {
    name = "NoActiveConnection";
    message = "You must call the connect() method before performing this operation";
}

/**
 * Thrown when an engine received an unexpected response
 */
export class UnexpectedResponse extends SurrealError {
    name = "UnexpectedResponse";
    message =
        "The returned response from the SurrealDB instance is in an unexpected format. Unable to process response!";
}

/**
 * Thrown when a provided connection URL is unsupported
 */
export class InvalidURLProvided extends SurrealError {
    name = "InvalidURLProvided";
    message = "The provided string is either not a URL or is a URL but with an invalid protocol!";
}

/**
 * Thrown when an engine disconnected from a datastore
 */
export class EngineDisconnected extends SurrealError {
    name = "EngineDisconnected";
    message = "The engine reported the connection to SurrealDB has dropped";
}

/**
 * Thrown when reconnect attempts have been exhausted
 */
export class ReconnectExhaustion extends SurrealError {
    name = "ReconnectExhaustion";
    message = "The engine failed exhausted all reconnect attempts";
}

/**
 * Thrown when a reconnect iterator fails to iterate
 */
export class ReconnectIterationError extends SurrealError {
    name = "ReconnectIterationError";
    message = "The reconnect iterator failed to iterate";
}

/**
 * Thrown when a future is dispatched more than once
 */
export class FutureDispatchedError extends SurrealError {
    name = "FutureDispatchedError";
    message = "The future has already been dispatched and cannot be reused";
}

/**
 * Thriwn when an unexpected response is received from the server
 */
export class UnexpectedServerResponse extends SurrealError {
    name = "UnexpectedServerResponse";

    constructor(public readonly response: unknown) {
        super();
        this.message = `${response}`;
    }
}

/**
 * Thrown when an unexpected connection error occurs
 */
export class UnexpectedConnectionError extends SurrealError {
    name = "UnexpectedConnectionError";
    message = "An unexpected connection error occurred";

    constructor(cause: unknown) {
        super();
        this.cause = cause;
    }
}

/**
 * Thrown when an engine is not supported
 */
export class UnsupportedEngine extends SurrealError {
    name = "UnsupportedEngine";
    message = "The engine you are trying to connect to is not supported or configured";

    constructor(public readonly engine: string) {
        super();
    }
}

/**
 * Thrown when a feature is not available for the current engine
 */
export class FeatureUnavailableForEngine extends SurrealError {
    name = "FeatureUnavailableForEngine";
    message = "The feature you are trying to use is not available on this engine";
}

/**
 * Thrown when there is no connection available
 */
export class ConnectionUnavailable extends SurrealError {
    name = "ConnectionUnavailable";
    message = "There is no connection available at this moment";
}

/**
 * Thrown when there is no namespace and/or database selected
 */
export class MissingNamespaceDatabase extends SurrealError {
    name = "MissingNamespaceDatabase";
    message = "There is no namespace and/or database selected";
}

/**
 * Thrown when a connection to the server fails
 */
export class HttpConnectionError extends SurrealError {
    name = "HttpConnectionError";

    constructor(
        public readonly message: string,
        public readonly status: number,
        public readonly statusText: string,
        public readonly buffer: ArrayBuffer,
    ) {
        super();
    }
}

/**
 * Thrown when a query could not be executed
 */
export class QueryError extends SurrealError {
    name = "QueryError";

    constructor(public readonly message: string) {
        super();
    }
}

/**
 * Thrown when a response from the server is not as expected
 */
export class ResponseError extends SurrealError {
    name = "ResponseError";
    code: number;

    constructor(response: { code: number; message: string }) {
        super(response.message);
        this.code = response.code;
    }
}

/**
 * Thrown when a namespace was not specified
 *
 * TODO Replace with `MissingNamespaceDatabase`
 */
export class NoNamespaceSpecified extends SurrealError {
    name = "NoNamespaceSpecified";
    message = "Please specify a namespace to use";
}

/**
 * Thrown when a database was not specified
 *
 * TODO Replace with `MissingNamespaceDatabase`
 */
export class NoDatabaseSpecified extends SurrealError {
    name = "NoDatabaseSpecified";
    message = "Please specify a database to use";
}

/**
 * Thrown when a token was not returned
 */
export class NoTokenReturned extends SurrealError {
    name = "NoTokenReturned";
    message = "Did not receive an authentication token";
}

/**
 * Thrown when authentication fails
 */
export class AuthenticationFailed extends SurrealError {
    name = "AuthenticationFailed";
    message = "Authentication did not succeed";

    constructor(cause: unknown) {
        super();
        this.cause = cause;
    }
}

/**
 * Thrown when a live subscription fails to listen
 */
export class LiveSubscriptionFailed extends SurrealError {
    name = "LiveSubscriptionFailed";
    message = "Live subscription failed to listen";

    constructor(cause: unknown) {
        super();
        this.cause = cause;
    }
}

/**
 * Thrown when the version of the remote datastore is not supported
 */
export class UnsupportedVersion extends SurrealError {
    name = "UnsupportedVersion";
    version: string;
    supportedRange: string;

    constructor(version: string, supportedRange: string) {
        super();
        this.version = version;
        this.supportedRange = supportedRange;
        this.message = `The version "${version}" reported by the engine is not supported by this library, expected a version that satisfies "${supportedRange}"`;
    }
}

/**
 * Thrown when version checking is unsuccessful
 */
export class VersionCheckFailure extends SurrealError {
    name = "VersionCheckFailure";
    message = "Failed to check version compatibility with the SurrealDB instance";

    constructor(
        readonly error?: Error | undefined,
        readonly response?: {
            code: number;
            message: string;
        },
    ) {
        super();
    }
}
