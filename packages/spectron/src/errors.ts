/** Base class for all Spectron client errors. */
export class SpectronError extends Error {
    override readonly name: string = "SpectronError";

    /** HTTP status code, or `0` for connection failures. */
    readonly status: number;

    /** Short error title from the API or a generic label. */
    readonly title: string;

    /** Human-readable detail when provided. */
    readonly detail: string | undefined;

    /** RFC 7807 `type` URI when provided. */
    readonly type: string | undefined;

    /** RFC 7807 `instance` when provided. */
    readonly instance: string | undefined;

    /** Additional problem-details fields. */
    readonly extensions: Record<string, unknown>;

    constructor(options: {
        status: number;
        title: string;
        detail?: string | null;
        type?: string | null;
        instance?: string | null;
        extensions?: Record<string, unknown>;
        cause?: unknown;
    }) {
        const detail = options.detail ?? undefined;
        let message = `[${options.status}] ${options.title}`;
        if (detail) message += `: ${detail}`;
        super(message, options.cause !== undefined ? { cause: options.cause as Error } : undefined);
        this.status = options.status;
        this.title = options.title;
        this.detail = detail;
        this.type = options.type ?? undefined;
        this.instance = options.instance ?? undefined;
        this.extensions = options.extensions ?? {};
    }
}

/** Missing or invalid bearer token (401). */
export class AuthError extends SpectronError {
    override readonly name: string = "AuthError";
}

/** Principal or scope floor rejected the call (403). */
export class ScopeError extends SpectronError {
    override readonly name: string = "ScopeError";
}

/** Resource not found (404). */
export class NotFoundError extends SpectronError {
    override readonly name: string = "NotFoundError";
}

/** Invalid request body or parameters (400 / 422). */
export class ValidationError extends SpectronError {
    override readonly name: string = "ValidationError";
}

/** Rate or token budget exceeded (429). */
export class RateLimitError extends SpectronError {
    override readonly name: string = "RateLimitError";

    /** Seconds from `Retry-After` when numeric. */
    readonly retryAfter: number | undefined;

    constructor(
        options: ConstructorParameters<typeof SpectronError>[0] & { retryAfter?: number | null },
    ) {
        super(options);
        this.retryAfter = options.retryAfter ?? undefined;
    }
}

/** Server error after retries exhausted (5xx). */
export class ServerError extends SpectronError {
    override readonly name: string = "ServerError";
}

/** Network failure, timeout, or other non-HTTP error (status 0). */
export class ConnectionError extends SpectronError {
    override readonly name: string = "ConnectionError";
}

type ErrorCtor = new (
    args: ConstructorParameters<typeof SpectronError>[0],
) => InstanceType<typeof SpectronError>;

const STATUS_MAP: Partial<Record<number, ErrorCtor>> = {
    400: ValidationError,
    401: AuthError,
    403: ScopeError,
    404: NotFoundError,
    422: ValidationError,
};

function parseRetryAfter(headers: Headers): number | undefined {
    const raw = headers.get("Retry-After") ?? headers.get("retry-after");
    if (raw === null) return undefined;
    const n = Number(raw);
    return Number.isFinite(n) ? n : undefined;
}

/**
 * Builds a typed error from an API error response body and headers.
 * @param status HTTP status code.
 * @param body Parsed JSON body or plain text, or null.
 * @param headers Response headers (for `Retry-After` on 429).
 */
export function errorFromResponse(status: number, body: unknown, headers: Headers): SpectronError {
    const extensions: Record<string, unknown> = {};
    let title = "Spectron request failed";
    let detail: string | undefined;
    let type: string | undefined;
    let instance: string | undefined;

    if (body !== null && typeof body === "object" && !Array.isArray(body)) {
        const o = body as Record<string, unknown>;
        const t = o.title ?? o.message;
        if (typeof t === "string") title = t;
        if (typeof o.detail === "string") detail = o.detail;
        if (typeof o.type === "string") type = o.type;
        if (typeof o.instance === "string") instance = o.instance;
        for (const [key, value] of Object.entries(o)) {
            if (!["status", "title", "detail", "type", "instance", "message"].includes(key)) {
                extensions[key] = value;
            }
        }
    } else if (typeof body === "string" && body.length > 0) {
        detail = body;
    }

    const base = { status, title, detail, type, instance, extensions };

    if (status >= 500) {
        return new ServerError(base);
    }

    if (status === 429) {
        return new RateLimitError({ ...base, retryAfter: parseRetryAfter(headers) });
    }

    const Ctor = STATUS_MAP[status];
    if (Ctor) {
        return new Ctor(base);
    }
    return new SpectronError(base);
}
