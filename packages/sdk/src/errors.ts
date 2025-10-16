export class SurrealError extends Error {}

/**
 * Thrown when an operation depends on an active connection
 */
export class NoActiveConnection extends SurrealError {
    override name = "NoActiveConnection";
    override message = "You must call the connect() method before performing this operation";
}

/**
 * Thrown when an engine received an unexpected response
 */
export class UnexpectedResponse extends SurrealError {
    override name = "UnexpectedResponse";
    override message =
        "The returned response from the SurrealDB instance is in an unexpected format. Unable to process response!";
}

/**
 * Thrown when a provided connection URL is unsupported
 */
export class InvalidURLProvided extends SurrealError {
    override name = "InvalidURLProvided";
    override message =
        "The provided string is either not a URL or is a URL but with an invalid protocol!";
}

/**
 * Thrown when an engine disconnected from a datastore
 */
export class EngineDisconnected extends SurrealError {
    override name = "EngineDisconnected";
    override message = "The engine reported the connection to SurrealDB has dropped";
}

/**
 * Thrown when reconnect attempts have been exhausted
 */
export class ReconnectExhaustion extends SurrealError {
    override name = "ReconnectExhaustion";
    override message = "The engine failed exhausted all reconnect attempts";
}

/**
 * Thrown when a reconnect iterator fails to iterate
 */
export class ReconnectIterationError extends SurrealError {
    override name = "ReconnectIterationError";
    override message = "The reconnect iterator failed to iterate";
}

/**
 * Thrown when a future is dispatched more than once
 */
export class FutureDispatchedError extends SurrealError {
    override name = "FutureDispatchedError";
    override message = "The future has already been dispatched and cannot be reused";
}

/**
 * Thriwn when an unexpected response is received from the server
 */
export class UnexpectedServerResponse extends SurrealError {
    override name = "UnexpectedServerResponse";

    constructor(public readonly response: unknown) {
        super();
        this.message = `${response}`;
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
export class UnsupportedEngine extends SurrealError {
    override name = "UnsupportedEngine";

    constructor(engine: string) {
        super(`The engine "${engine}" is not supported or configured`);
    }
}

/**
 * Thrown when a feature is not available for the current engine
 */
export class FeatureUnavailableForEngine extends SurrealError {
    override name = "FeatureUnavailableForEngine";
    override message = "The feature you are trying to use is not available on this engine";
}

/**
 * Thrown when there is no connection available
 */
export class ConnectionUnavailable extends SurrealError {
    override name = "ConnectionUnavailable";
    override message = "There is no connection available at this moment";
}

/**
 * Thrown when there is no namespace and/or database selected
 */
export class MissingNamespaceDatabase extends SurrealError {
    override name = "MissingNamespaceDatabase";
    override message = "There is no namespace and/or database selected";
}

/**
 * Thrown when a connection to the server fails
 */
export class HttpConnectionError extends SurrealError {
    override name = "HttpConnectionError";

    constructor(
        public override readonly message: string,
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
    override name = "QueryError";

    constructor(public override readonly message: string) {
        super();
    }
}

/**
 * Thrown when a response from the server is not as expected
 */
export class ResponseError extends SurrealError {
    override name = "ResponseError";
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
    override name = "NoNamespaceSpecified";
    override message = "Please specify a namespace to use";
}

/**
 * Thrown when a database was not specified
 *
 * TODO Replace with `MissingNamespaceDatabase`
 */
export class NoDatabaseSpecified extends SurrealError {
    override name = "NoDatabaseSpecified";
    override message = "Please specify a database to use";
}

/**
 * Thrown when a token was not returned
 */
export class NoTokenReturned extends SurrealError {
    override name = "NoTokenReturned";
    override message = "Did not receive an authentication token";
}

/**
 * Thrown when authentication fails
 */
export class AuthenticationFailed extends SurrealError {
    override name = "AuthenticationFailed";
    override message = "Authentication did not succeed";

    constructor(cause: unknown) {
        super();
        this.cause = cause;
    }
}

/**
 * Thrown when a live subscription fails to listen
 */
export class LiveSubscriptionFailed extends SurrealError {
    override name = "LiveSubscriptionFailed";
    override message = "Live subscription failed to listen";

    constructor(cause: unknown) {
        super();
        this.cause = cause;
    }
}

/**
 * Thrown when the version of the remote datastore is not supported
 */
export class UnsupportedVersion extends SurrealError {
    override name = "UnsupportedVersion";
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
    override name = "VersionCheckFailure";
    override message = "Failed to check version compatibility with the SurrealDB instance";

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

/**
 * Thrown when an expression is invalid
 */
export class ExpressionError extends SurrealError {
    override name = "ExpressionError";
    override message = "Failed to parse invalid expression";

    constructor(public override readonly cause?: unknown) {
        super();
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
