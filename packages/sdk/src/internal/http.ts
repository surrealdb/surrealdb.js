import { HttpConnectionError } from "../errors";
import type { ConnectionSession, ConnectionState, DriverContext } from "../types/surreal";
import { abortReason, raceAbort, throwIfAborted } from "./abort";
import { wrapSqonError } from "./wrap-sqon-error";

export interface FetchSurrealOptions {
    body?: unknown;
    url?: URL;
    headers?: Record<string, string>;
    method?: string;
    /** Abandons the request, and the reading of its response, when it aborts */
    signal?: AbortSignal;
}

/**
 * Read a response body in full, without waiting on it beyond what the signal allows.
 *
 * A `fetch` given the signal errors the body itself when it aborts. This does not rely on it, so
 * that a `fetchImpl` which ignores signals cannot keep the caller waiting for the rest of a body.
 */
export function readBody(response: Response, signal?: AbortSignal): Promise<ArrayBuffer> {
    return raceAbort(response.arrayBuffer(), signal);
}

/**
 * Read a response body in full, cancelling the stream if the signal aborts first.
 *
 * Unlike `readBody`, which is for the small answer of an RPC call and leaves the stream to `fetch`,
 * this reads a body which may be very large and is likely to be streamed, so what it holds is let go
 * of when the signal aborts, whatever `fetch` did with it. The reason of the signal is thrown.
 */
async function readChunks(
    response: Response,
    signal: AbortSignal,
    onChunk: (chunk: Uint8Array) => void,
): Promise<void> {
    throwIfAborted(signal);

    if (!response.body) {
        onChunk(new Uint8Array(await raceAbort(response.arrayBuffer(), signal)));
        return;
    }

    const reader = response.body.getReader();
    const cancel = () => {
        reader.cancel(abortReason(signal)).catch(() => {});
    };

    signal.addEventListener("abort", cancel, { once: true });

    try {
        for (;;) {
            const { done, value } = await reader.read();

            // A cancelled stream reads as finished, which is not the whole of the body
            throwIfAborted(signal);

            if (done) return;
            onChunk(value);
        }
    } finally {
        signal.removeEventListener("abort", cancel);
        reader.releaseLock();
    }
}

/**
 * Read a response as text, cancelling the stream if the signal aborts first.
 */
export async function readText(response: Response, signal?: AbortSignal): Promise<string> {
    if (!signal) return response.text();

    const decoder = new TextDecoder();
    let text = "";

    await readChunks(response, signal, (chunk) => {
        text += decoder.decode(chunk, { stream: true });
    });

    return text + decoder.decode();
}

/**
 * Read a response as bytes, cancelling the stream if the signal aborts first.
 */
export async function readBytes(response: Response, signal?: AbortSignal): Promise<Uint8Array> {
    if (!signal) return new Uint8Array(await response.arrayBuffer());

    const parts: Uint8Array[] = [];
    let length = 0;

    await readChunks(response, signal, (chunk) => {
        parts.push(chunk);
        length += chunk.byteLength;
    });

    const bytes = new Uint8Array(length);
    let offset = 0;

    for (const part of parts) {
        bytes.set(part, offset);
        offset += part.byteLength;
    }

    return bytes;
}

/** Release a response nobody is going to read */
export function releaseResponse(response: Response): void {
    response.body?.cancel().catch(() => {});
}

export async function fetchSurreal(
    context: DriverContext,
    state: ConnectionState,
    session: ConnectionSession,
    options: FetchSurrealOptions,
): Promise<Response> {
    const endpoint = new URL(options.url ?? state.url);
    const fetchImpl = context.options.fetchImpl ?? globalThis.fetch;
    const headerMap: Record<string, string> = {
        "Content-Type": "application/cbor",
        Accept: "application/cbor",
        ...options.headers,
    };

    if (session.namespace) {
        headerMap["Surreal-NS"] = session.namespace;
    }

    if (session.database) {
        headerMap["Surreal-DB"] = session.database;
    }

    if (session.accessToken) {
        headerMap.Authorization = `Bearer ${session.accessToken}`;
    }

    endpoint.protocol = endpoint.protocol.replace("ws", "http");

    // Nothing is sent for a request which has been abandoned already
    throwIfAborted(options.signal);

    const encodedBody = encodeBody(context, options.body, options.signal);
    const response = await raceAbort(
        fetchImpl(endpoint, {
            ...context.options.fetchOptions,
            method: options.method ?? "POST",
            headers: headerMap,
            body: encodedBody,
            signal: options.signal,
            // @ts-expect-error TS is dumb
            duplex: "half",
        }),
        options.signal,
        releaseResponse,
    );

    if (response.status === 200) {
        return response;
    }

    const buffer = await readBody(response, options.signal);

    throw new HttpConnectionError(
        new TextDecoder("utf-8").decode(buffer),
        response.status,
        response.statusText,
        buffer,
    );
}

const REMOTE_PROTOCOLS = new Set(["http", "https", "ws", "wss"]);

export function parseEndpoint(value: string | URL): URL {
    const url = typeof value === "string" ? new URL(value) : new URL(value.href);
    const protocol = url.protocol.slice(0, -1);

    if (REMOTE_PROTOCOLS.has(protocol) && !url.pathname.endsWith("/rpc")) {
        if (!url.pathname.endsWith("/")) url.pathname += "/";
        url.pathname += "rpc";
    }

    return url;
}

/**
 * Pass a stream on, until a signal aborts: the stream is then cancelled with the reason of the
 * signal, and what it was passed to is errored with it.
 *
 * This is written out rather than done with `pipeThrough(transform, { signal })`, whose `signal`
 * option is not honoured by every runtime. Some, among them older versions of Bun, leave the source
 * open when it aborts, which is exactly what this is here to prevent.
 */
function abortableStream(source: ReadableStream, signal: AbortSignal): ReadableStream {
    const reader = source.getReader();
    let onAbort: (() => void) | undefined;

    const unwatch = () => {
        if (onAbort) signal.removeEventListener("abort", onAbort);
        onAbort = undefined;
    };

    return new ReadableStream({
        start(controller) {
            onAbort = () => {
                const reason = abortReason(signal);

                onAbort = undefined;
                reader.cancel(reason).catch(() => {});
                controller.error(reason);
            };

            signal.addEventListener("abort", onAbort, { once: true });
        },

        async pull(controller) {
            try {
                const { done, value } = await reader.read();

                // Reading ended because the abort cancelled the source, which is not the end of it
                if (signal.aborted) return;

                if (done) {
                    unwatch();
                    controller.close();
                    return;
                }

                controller.enqueue(value);
            } catch (error) {
                unwatch();
                controller.error(error);
            }
        },

        // Whatever the stream was passed to has had enough, so the source is told so. When that is
        // `fetch` giving up because of the signal, it may well be asking before the abort event
        // reaches the listener above, since a runtime runs its own abort steps first, and does not
        // always say why. The signal does.
        cancel(reason) {
            unwatch();
            return reader.cancel(signal.aborted ? abortReason(signal) : reason);
        },
    });
}

function encodeBody(
    context: DriverContext,
    body?: unknown,
    signal?: AbortSignal,
): BodyInit | undefined {
    // A stream being uploaded is handed over through one which the signal tears down, so that
    // aborting cancels the stream of the caller with the reason of the signal, rather than relying
    // on `fetch` to do so, which a `fetchImpl` which ignores signals will not.
    if (body instanceof ReadableStream) {
        return signal ? abortableStream(body, signal) : body;
    }

    if (body instanceof Blob) {
        return body;
    }

    return body ? new Uint8Array(wrapSqonError(() => context.codecs.cbor.encode(body))) : undefined;
}
