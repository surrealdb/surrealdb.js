import type { Feature } from "./internal/feature";
import type { Session } from "./types";

export class SurrealError extends Error {}

/**
 * Thrown when a call has been terminated because the connection was closed
 */
export class CallTerminatedError extends SurrealError {
    override name = "CallTerminatedError";
    override message = "The call has been termined because the connection was closed";
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

/**
 * Thrown when a response from the server is not as expected
 */
export class ResponseError extends SurrealError {
    override name = "ResponseError";

    readonly code: number;

    constructor(response: { code: number; message: string }) {
        super(response.message);
        this.code = response.code;
    }
}

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
    override message = "Live subscription failed to listen";

    constructor(cause: unknown) {
        super();
        this.cause = cause;
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
    override message = "Failed to parse invalid expression";

    constructor(cause?: unknown) {
        super();
        this.cause = cause;
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
 * Thrown when a parsed date is invalid
 */
export class InvalidDateError extends SurrealError {
    override name = "InvalidDateError";
    override message = "The provided date is invalid";

    constructor(date: Date) {
        super(`The provided date is invalid: ${date}`);
    }
}

/**
 * Thrown when a feature is not supported by the current engine
 */
export class UnsupportedFeatureError extends SurrealError {
    override name = "UnsupportedFeatureError";

    readonly feature: Feature;

    constructor(feature: Feature) {
        super(`The configured engine does not support the feature: ${feature}`);
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
        super(`The version of SurrealDB (${version}) does not support the feature: ${feature}`);
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
