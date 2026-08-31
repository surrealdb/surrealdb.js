import { CancelledError, ConnectionError, errorFromResponse } from "./errors.js";
import { idempotencyKey } from "./idempotency.js";
import { backoffSchedule, shouldRetry } from "./retry.js";

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 3;

/** Progress of a request body being sent, reported while an upload is in flight. */
export interface UploadProgress {
    /** Bytes handed to the network so far. */
    loaded: number;
    /** Total bytes to send, when the environment can determine it. */
    total?: number;
}

/** Reports upload progress. Called repeatedly while the request body is sent. */
export type UploadProgressListener = (progress: UploadProgress) => void;

export interface TransportOptions {
    /** API endpoint origin without trailing slash. */
    endpoint: string;
    /** API key sent as an `Authorization: Bearer` token (required). */
    apiKey: string;
    /** Request timeout in milliseconds. */
    timeoutMs?: number;
    /** Maximum retry attempts for idempotent requests. */
    maxRetries?: number;
    /** Override `fetch` (testing). */
    fetchImpl?: typeof fetch;
    /** Principal id to act on behalf of, sent as `X-Agent-Memory-On-Behalf-Of`. */
    onBehalfOf?: string;
}

function buildUrl(endpoint: string, path: string, query?: Record<string, unknown>): string {
    const urlStr =
        path.startsWith("http://") || path.startsWith("https://")
            ? path
            : `${endpoint.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
    if (!query || Object.keys(query).length === 0) return urlStr;
    const url = new URL(urlStr);
    for (const [k, v] of Object.entries(query)) {
        if (v === undefined || v === null) continue;
        url.searchParams.set(k, String(v));
    }
    return url.toString();
}

function decodeBody(text: string): unknown {
    if (!text) return null;
    try {
        return JSON.parse(text) as unknown;
    } catch {
        return text;
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
}

/**
 * Combines a caller's abort signal with an internal one.
 *
 * The internal signal carries the request timeout, so it cannot simply be
 * replaced by the caller's — both have to be able to abort the request.
 *
 * @returns A cleanup function that detaches the forwarding listener.
 */
function forwardAbort(from: AbortSignal | undefined, to: AbortController): () => void {
    if (!from) return () => {};

    if (from.aborted) {
        to.abort();
        return () => {};
    }

    const onAbort = () => to.abort();
    from.addEventListener("abort", onAbort, { once: true });

    return () => from.removeEventListener("abort", onAbort);
}

/**
 * Sends a multipart body with `XMLHttpRequest` so its progress can be observed.
 *
 * `fetch` cannot report how much of a request body has been sent in any browser,
 * which leaves a large upload indistinguishable from a stalled one. This path is
 * used only when a caller asks for progress; everything else stays on `fetch`.
 */
function sendWithProgress(options: {
    url: string;
    method: string;
    headers: Record<string, string>;
    body: FormData;
    signal: AbortSignal;
    onProgress: UploadProgressListener;
}): Promise<{ status: number; text: string; headers: Headers }> {
    const { url, method, headers, body, signal, onProgress } = options;

    return new Promise((resolve, reject) => {
        const request = new XMLHttpRequest();
        request.open(method, url, true);

        for (const [name, value] of Object.entries(headers)) {
            request.setRequestHeader(name, value);
        }

        request.upload.addEventListener("progress", (event) => {
            onProgress({
                loaded: event.loaded,
                total: event.lengthComputable ? event.total : undefined,
            });
        });

        request.addEventListener("load", () => {
            resolve({
                status: request.status,
                text: request.responseText,
                // `XMLHttpRequest` exposes headers as one CRLF-delimited string.
                headers: parseRawHeaders(request.getAllResponseHeaders()),
            });
        });

        request.addEventListener("error", () => reject(new TypeError("Network request failed")));

        // Both aborts land here, so the caller's cancellation and the timeout are
        // told apart by the caller's own signal rather than by the event.
        request.addEventListener("abort", () => {
            const error = new Error("Request aborted");
            error.name = "AbortError";
            reject(error);
        });

        const onAbort = () => request.abort();

        if (signal.aborted) {
            request.abort();
        } else {
            signal.addEventListener("abort", onAbort, { once: true });
        }

        request.addEventListener("loadend", () => signal.removeEventListener("abort", onAbort));
        request.send(body);
    });
}

function parseRawHeaders(raw: string): Headers {
    const headers = new Headers();

    for (const line of raw.trim().split(/[\r\n]+/)) {
        const separator = line.indexOf(":");
        if (separator === -1) continue;
        headers.append(line.slice(0, separator).trim(), line.slice(separator + 1).trim());
    }

    return headers;
}

/**
 * Performs authenticated HTTP requests with retries, idempotency keys, JSON
 * handling, and server-sent-event streaming.
 */
export class Transport {
    private readonly endpoint: string;

    private readonly apiKey: string;

    private readonly timeoutMs: number;

    private readonly maxRetries: number;

    private readonly fetchImpl: typeof fetch;

    private readonly onBehalfOf?: string;

    constructor(options: TransportOptions) {
        if (!options.endpoint) {
            throw new TypeError("Agent Memory endpoint is required.");
        }
        if (!options.apiKey) {
            throw new TypeError("Agent Memory API key is required.");
        }
        this.endpoint = options.endpoint.replace(/\/$/, "");
        this.apiKey = options.apiKey;
        this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
        this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
        this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
        this.onBehalfOf = options.onBehalfOf;
    }

    /**
     * Returns a copy of this transport that issues every request on behalf of
     * `principalId` (adds the `X-Agent-Memory-On-Behalf-Of` header).
     */
    withOnBehalfOf(principalId: string): Transport {
        return new Transport({
            endpoint: this.endpoint,
            apiKey: this.apiKey,
            timeoutMs: this.timeoutMs,
            maxRetries: this.maxRetries,
            fetchImpl: this.fetchImpl,
            onBehalfOf: principalId,
        });
    }

    /** Builds the common request headers, including delegation when configured. */
    private baseHeaders(accept: string): Record<string, string> {
        const headers: Record<string, string> = {
            Accept: accept,
            Authorization: `Bearer ${this.apiKey}`,
            "User-Agent": `surrealdb-memory-js/${import.meta.env.VERSION}`,
        };
        if (this.onBehalfOf) headers["X-Agent-Memory-On-Behalf-Of"] = this.onBehalfOf;
        return headers;
    }

    /**
     * Sends a JSON or multipart request.
     * @returns Parsed JSON, or `null` for empty 204 responses.
     */
    async requestJson(
        method: string,
        path: string,
        init?: {
            query?: Record<string, unknown>;
            body?: unknown;
            timeoutMs?: number;
            idempotent?: boolean;
            /** Aborts the request. Rejects with {@link CancelledError}. */
            signal?: AbortSignal;
            /** Observes a multipart body being sent. Ignored for JSON bodies. */
            onUploadProgress?: UploadProgressListener;
        },
    ): Promise<unknown | null> {
        const methodUpper = method.toUpperCase();
        const url = buildUrl(this.endpoint, path, init?.query);
        const schedule = backoffSchedule(this.maxRetries);

        const headerObj = this.baseHeaders("application/json");

        let body: BodyInit | undefined;
        let serialisedBody = "";
        const bodyInput = init?.body;
        const isMultipart = bodyInput instanceof FormData;

        if (bodyInput !== undefined) {
            if (isMultipart) {
                body = bodyInput;
            } else {
                serialisedBody = JSON.stringify(bodyInput);
                body = serialisedBody;
                headerObj["Content-Type"] = "application/json";
            }
        }

        // Multipart uploads can legitimately stream large bodies for longer than
        // the default request timeout, so the fixed deadline is not applied to
        // them, only an explicit per-request `timeoutMs` bounds a multipart send.
        const timeoutMs = isMultipart
            ? (init?.timeoutMs ?? 0)
            : (init?.timeoutMs ?? this.timeoutMs);

        // Idempotent writes carry a key so retries within a 30s window collapse
        // to a single server-side effect.
        if (init?.idempotent) {
            headerObj["Idempotency-Key"] = await idempotencyKey(methodUpper, path, serialisedBody);
        }

        // Already cancelled before it began, so there is nothing worth sending.
        if (init?.signal?.aborted) {
            throw new CancelledError({
                status: 0,
                title: "Request cancelled",
                detail: "The signal was already aborted",
            });
        }

        // Progress can only be observed through `XMLHttpRequest`, so it is used
        // for a multipart body when — and only when — a caller asks to observe one.
        const withProgress =
            isMultipart &&
            init?.onUploadProgress !== undefined &&
            typeof XMLHttpRequest !== "undefined";

        let attempt = 0;
        for (;;) {
            const controller = new AbortController();
            const detachAbort = forwardAbort(init?.signal, controller);
            const timer =
                timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : undefined;
            const headersForFetch: HeadersInit = { ...headerObj };

            if (body instanceof FormData) {
                delete (headersForFetch as Record<string, string>)["Content-Type"];
            }

            try {
                const response = withProgress
                    ? await sendWithProgress({
                          url,
                          method: methodUpper,
                          headers: headersForFetch as Record<string, string>,
                          body: body as FormData,
                          signal: controller.signal,
                          // biome-ignore lint/style/noNonNullAssertion: guarded by `withProgress`.
                          onProgress: init!.onUploadProgress!,
                      }).then(({ status, text, headers }) => ({
                          status,
                          ok: status >= 200 && status < 300,
                          headers,
                          text: () => Promise.resolve(text),
                      }))
                    : await this.fetchImpl(url, {
                          method: methodUpper,
                          headers: headersForFetch,
                          body: methodUpper === "GET" || methodUpper === "HEAD" ? undefined : body,
                          signal: controller.signal,
                      });

                clearTimeout(timer);
                detachAbort();

                if (
                    response.status >= 400 &&
                    shouldRetry(
                        methodUpper,
                        response.status,
                        attempt,
                        this.maxRetries,
                        init?.idempotent,
                    )
                ) {
                    await sleep(schedule[attempt] ?? 1000);
                    attempt += 1;
                    continue;
                }

                const text = await response.text();

                if (!response.ok) {
                    throw errorFromResponse(response.status, decodeBody(text), response.headers);
                }

                if (response.status === 204 || text.length === 0) {
                    return null;
                }
                return decodeBody(text);
            } catch (e) {
                clearTimeout(timer);
                detachAbort();
                if (e instanceof Error && e.name === "AbortError") {
                    // A caller's cancellation is not a failure, and must never be
                    // retried: the request it would retry is the one being abandoned.
                    if (init?.signal?.aborted) {
                        throw new CancelledError({
                            status: 0,
                            title: "Request cancelled",
                            detail: "The request was aborted by the caller",
                            cause: e,
                        });
                    }

                    throw new ConnectionError({
                        status: 0,
                        title: "Request timed out",
                        detail: `Exceeded ${timeoutMs}ms`,
                        cause: e,
                    });
                }
                if (
                    shouldRetry(methodUpper, null, attempt, this.maxRetries, init?.idempotent) &&
                    !(e instanceof Error && "status" in e)
                ) {
                    await sleep(schedule[attempt] ?? 1000);
                    attempt += 1;
                    continue;
                }
                if (e && typeof e === "object" && "status" in e) {
                    throw e;
                }
                throw new ConnectionError({
                    status: 0,
                    title: "Connection failed",
                    detail: e instanceof Error ? e.message : String(e),
                    cause: e,
                });
            }
        }
    }

    /**
     * GET that returns raw bytes (e.g. document `raw`).
     */
    async requestBytes(
        method: string,
        path: string,
        init?: { query?: Record<string, unknown>; timeoutMs?: number },
    ): Promise<ArrayBuffer> {
        const methodUpper = method.toUpperCase();
        const url = buildUrl(this.endpoint, path, init?.query);
        const timeoutMs = init?.timeoutMs ?? this.timeoutMs;
        const schedule = backoffSchedule(this.maxRetries);
        const headers = this.baseHeaders("*/*");

        let attempt = 0;
        for (;;) {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), timeoutMs);
            try {
                const response = await this.fetchImpl(url, {
                    method: methodUpper,
                    headers,
                    signal: controller.signal,
                });
                clearTimeout(timer);

                if (
                    response.status >= 400 &&
                    shouldRetry(methodUpper, response.status, attempt, this.maxRetries)
                ) {
                    await sleep(schedule[attempt] ?? 1000);
                    attempt += 1;
                    continue;
                }

                if (!response.ok) {
                    const text = await response.text();
                    throw errorFromResponse(response.status, decodeBody(text), response.headers);
                }
                return await response.arrayBuffer();
            } catch (e) {
                clearTimeout(timer);
                if (e instanceof Error && e.name === "AbortError") {
                    throw new ConnectionError({
                        status: 0,
                        title: "Request timed out",
                        detail: `Exceeded ${timeoutMs}ms`,
                        cause: e,
                    });
                }
                if (shouldRetry(methodUpper, null, attempt, this.maxRetries)) {
                    await sleep(schedule[attempt] ?? 1000);
                    attempt += 1;
                    continue;
                }
                if (e && typeof e === "object" && "status" in e) {
                    throw e;
                }
                throw new ConnectionError({
                    status: 0,
                    title: "Connection failed",
                    detail: e instanceof Error ? e.message : String(e),
                    cause: e,
                });
            }
        }
    }

    /**
     * Opens a server-sent-event stream (e.g. streaming `chat`).
     *
     * Streams are not retried; the returned {@link Response} carries the raw SSE
     * body for the caller to parse.
     */
    async stream(
        method: string,
        path: string,
        init?: { query?: Record<string, unknown>; body?: unknown },
    ): Promise<Response> {
        const methodUpper = method.toUpperCase();
        const url = buildUrl(this.endpoint, path, init?.query);
        const headers = this.baseHeaders("text/event-stream");

        let body: BodyInit | undefined;
        if (init?.body !== undefined) {
            body = JSON.stringify(init.body);
            headers["Content-Type"] = "application/json";
        }

        let response: Response;
        try {
            response = await this.fetchImpl(url, { method: methodUpper, headers, body });
        } catch (e) {
            throw new ConnectionError({
                status: 0,
                title: "Connection failed",
                detail: e instanceof Error ? e.message : String(e),
                cause: e,
            });
        }

        if (!response.ok) {
            const text = await response.text();
            throw errorFromResponse(response.status, decodeBody(text), response.headers);
        }
        return response;
    }
}
