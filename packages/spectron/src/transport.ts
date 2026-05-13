import { ConnectionError, errorFromResponse } from "./errors.js";
import { backoffSchedule, shouldRetry } from "./retry.js";

const DEFAULT_BASE_URL = "https://api.spectron.dev";
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 3;

export interface TransportOptions {
    /** API origin without trailing slash, e.g. `https://api.spectron.dev`. */
    baseUrl?: string;
    /** Bearer API key (required). */
    apiKey: string;
    /** Request timeout in milliseconds. */
    timeoutMs?: number;
    /** Maximum retry attempts for idempotent GET requests. */
    maxRetries?: number;
    /** Override `fetch` (testing). */
    fetchImpl?: typeof fetch;
}

function buildUrl(baseUrl: string, path: string, query?: Record<string, unknown>): string {
    const urlStr =
        path.startsWith("http://") || path.startsWith("https://")
            ? path
            : `${baseUrl.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
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
 * Performs authenticated HTTP requests with GET retries and JSON handling.
 */
export class Transport {
    private readonly baseUrl: string;

    private readonly apiKey: string;

    private readonly timeoutMs: number;

    private readonly maxRetries: number;

    private readonly fetchImpl: typeof fetch;

    constructor(options: TransportOptions) {
        if (!options.apiKey) {
            throw new TypeError("Spectron API key is required.");
        }
        this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
        this.apiKey = options.apiKey;
        this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
        this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
        this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    }

    /**
     * Sends a JSON or multipart request.
     * @returns Parsed JSON, or `null` for empty 204 responses.
     */
    async requestJson(
        method: string,
        path: string,
        init?: { query?: Record<string, unknown>; body?: unknown; timeoutMs?: number },
    ): Promise<unknown | null> {
        const methodUpper = method.toUpperCase();
        const url = buildUrl(this.baseUrl, path, init?.query);
        const timeoutMs = init?.timeoutMs ?? this.timeoutMs;
        const schedule = backoffSchedule(this.maxRetries);

        const headerObj: Record<string, string> = {
            Accept: "application/json",
            Authorization: `Bearer ${this.apiKey}`,
            "User-Agent": `surrealdb-spectron-js/${import.meta.env.VERSION}`,
        };

        let body: BodyInit | undefined;
        const bodyInput = init?.body;
        if (bodyInput !== undefined) {
            if (bodyInput instanceof FormData) {
                body = bodyInput;
            } else {
                body = JSON.stringify(bodyInput);
                headerObj["Content-Type"] = "application/json";
            }
        }

        let attempt = 0;
        for (;;) {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), timeoutMs);
            const headersForFetch: HeadersInit = { ...headerObj };
            if (body instanceof FormData) {
                delete (headersForFetch as Record<string, string>)["Content-Type"];
            }

            try {
                const response = await this.fetchImpl(url, {
                    method: methodUpper,
                    headers: headersForFetch,
                    body: methodUpper === "GET" || methodUpper === "HEAD" ? undefined : body,
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
                if (e instanceof Error && e.name === "AbortError") {
                    throw new ConnectionError({
                        status: 0,
                        title: "Request timed out",
                        detail: `Exceeded ${timeoutMs}ms`,
                        cause: e,
                    });
                }
                if (
                    shouldRetry(methodUpper, null, attempt, this.maxRetries) &&
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
        const url = buildUrl(this.baseUrl, path, init?.query);
        const timeoutMs = init?.timeoutMs ?? this.timeoutMs;
        const schedule = backoffSchedule(this.maxRetries);
        const headers: Record<string, string> = {
            Accept: "*/*",
            Authorization: `Bearer ${this.apiKey}`,
            "User-Agent": `surrealdb-spectron-js/${import.meta.env.VERSION}`,
        };

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
}
