import { HttpConnectionError, SurrealError } from "../errors";
import type { Token } from "../types/auth";
import type {
    ConnectionSession,
    ConnectionState,
    CredentialSource,
    DriverContext,
    ProgressCallback,
    Session,
} from "../types/surreal";
import { abortReason, raceAbort, throwIfAborted } from "./abort";
import { countBytes } from "./progress";
import { wrapSqonError } from "./wrap-sqon-error";

export interface FetchSurrealOptions {
    body?: unknown;
    url?: URL;
    headers?: Record<string, string>;
    method?: string;
    /**
     * A token to present for this request only, instead of the one of the session.
     */
    token?: Token;
    /**
     * Whether to present the credential resolved for each request, if the connection
     * resolves credentials that way. Disabled for requests which establish credentials
     * themselves. Defaults to true.
     */
    resolve?: boolean;
    /** Abandons the request, and the reading of its response, when it aborts */
    signal?: AbortSignal;
    /** Reports how much of the body has been uploaded, where the runtime lets that be seen */
    uploadProgress?: ProgressCallback;
    /** Statuses besides `200` which answer the request, returned for the caller to read */
    answers?: readonly number[];
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

    endpoint.protocol = endpoint.protocol.replace("ws", "http");

    // Nothing is sent for a request which has been abandoned already
    throwIfAborted(options.signal);

    // A credential which is decided for a single request is only ever presented to the
    // connection it was resolved for, and never follows a redirect elsewhere.
    const source =
        options.token === undefined && options.resolve !== false ? state.credentials : undefined;
    const scoped = options.token !== undefined || source !== undefined;

    if (scoped && endpoint.origin !== originOf(state.url)) {
        throw new SurrealError("Request credentials are only sent to the origin of the connection");
    }

    // A stream which is uploaded is taken over before anything is waited for, so that abandoning the
    // request while its credential is being resolved lets go of the stream of the caller just as
    // abandoning it during the upload does, and the wait is not what leaves it open.
    const encodedBody = encodeBody(context, options.body, options.signal);

    let token = options.token ?? session.accessToken;

    if (source) {
        try {
            token = await resolveToken(source, session.id, undefined, options.signal);
        } catch (error) {
            discardBody(encodedBody, error);
            throw error;
        }
    }

    const progress = options.uploadProgress;

    // Browsers stream request bodies over HTTP/2 only, if at all, so their uploads are followed with XHR
    const xhrBody =
        progress &&
        encodedBody instanceof Blob &&
        !scoped &&
        !context.options.fetchImpl &&
        typeof XMLHttpRequest === "function"
            ? encodedBody
            : undefined;

    // Elsewhere the body is counted as `fetch` reads it, afresh for each attempt
    const bodyFor = (): BodyInit | undefined => {
        if (!progress) return encodedBody;

        if (encodedBody instanceof ReadableStream) {
            return countBytes(encodedBody, progress);
        }

        if (encodedBody instanceof Blob && typeof XMLHttpRequest !== "function") {
            const stream = encodedBody.stream();

            return countBytes(
                options.signal ? abortableStream(stream, options.signal) : stream,
                progress,
                encodedBody.size,
            );
        }

        return encodedBody;
    };

    const attempt = (bearer: Token | undefined): Promise<Response> => {
        const headers = bearer ? { ...headerMap, Authorization: `Bearer ${bearer}` } : headerMap;
        const method = options.method ?? "POST";

        if (xhrBody && progress) {
            return uploadWithXhr(endpoint, {
                method,
                headers,
                body: xhrBody,
                credentials: context.options.fetchOptions?.credentials,
                signal: options.signal,
                progress,
            });
        }

        return raceAbort(
            fetchImpl(endpoint, {
                ...context.options.fetchOptions,
                method,
                headers,
                body: bodyFor(),
                ...(scoped ? { redirect: "manual" as const } : {}),
                signal: options.signal,
                // @ts-expect-error TS is dumb
                duplex: "half",
            }),
            options.signal,
            releaseResponse,
        );
    };

    let response = await attempt(token);

    // The server answers 401 to a token it does not accept, such as one which has expired, before
    // it executes anything. This is the one rejection which is known to not have been applied, so
    // it is safe to ask for a new credential and send the request again, once, whatever the
    // request does. A body which has been streamed out cannot be sent again. Abandoning the
    // request ends the wait for the new credential, and the replay, like anything else.
    if (response.status === 401 && source && token && !(encodedBody instanceof ReadableStream)) {
        const renewed = await resolveToken(source, session.id, token, options.signal);

        if (renewed && renewed !== token) {
            releaseResponse(response);
            response = await attempt(renewed);
        }
    }

    if (response.status === 200 || options.answers?.includes(response.status)) {
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

interface XhrUpload {
    method: string;
    headers: Record<string, string>;
    body: Blob;
    credentials: RequestCredentials | undefined;
    signal: AbortSignal | undefined;
    progress: ProgressCallback;
}

/** Statuses whose response has no body, which a `Response` refuses to be given one for */
const NULL_BODY_STATUSES = new Set([101, 204, 205, 304]);

/**
 * Upload a body with `XMLHttpRequest`, reporting its progress, and answer as `fetch` would: once the
 * headers arrive, with a body which cancelling stops the download of. XHR cannot stream a response,
 * so the body is read from the `Blob` it downloads into, which the browser keeps out of the page's
 * memory.
 */
function uploadWithXhr(url: URL, request: XhrUpload): Promise<Response> {
    const { signal, progress } = request;
    const xhr = new XMLHttpRequest();
    const onAbort = () => xhr.abort();

    let downloaded!: { resolve: (blob: Blob) => void; reject: (reason: unknown) => void };
    const download = new Promise<Blob>((resolve, reject) => {
        downloaded = { resolve, reject };
    });

    // A body nobody reads leaves a failed download unobserved
    download.catch(() => {});

    return new Promise((resolve, reject) => {
        let answered = false;
        const fail = (reason: unknown) => (answered ? downloaded.reject(reason) : reject(reason));

        xhr.open(request.method, url.href);
        xhr.responseType = "blob";
        xhr.withCredentials = request.credentials === "include";

        for (const [name, value] of Object.entries(request.headers)) {
            xhr.setRequestHeader(name, value);
        }

        xhr.upload.onprogress = (event) => {
            progress({
                loaded: event.loaded,
                total: event.lengthComputable ? event.total : request.body.size,
            });
        };

        xhr.onreadystatechange = () => {
            // HEADERS_RECEIVED
            if (xhr.readyState !== 2) return;

            answered = true;
            resolve(
                new Response(NULL_BODY_STATUSES.has(xhr.status) ? null : blobBody(download, xhr), {
                    status: xhr.status,
                    statusText: xhr.statusText,
                }),
            );
        };

        xhr.onload = () => downloaded.resolve(xhr.response);
        xhr.onerror = () => fail(new TypeError("Failed to fetch"));
        xhr.onabort = () =>
            fail(signal ? abortReason(signal) : new TypeError("The request was aborted"));
        xhr.onloadend = () => signal?.removeEventListener("abort", onAbort);

        signal?.addEventListener("abort", onAbort, { once: true });
        xhr.send(request.body);
    });
}

/** A body read from a downloaded `Blob` a chunk at a time, whose cancelling aborts the download */
function blobBody(download: Promise<Blob>, xhr: XMLHttpRequest): ReadableStream<Uint8Array> {
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;

    return new ReadableStream<Uint8Array>(
        {
            async pull(controller) {
                reader ??= (await download).stream().getReader();

                const { done, value } = await reader.read();

                if (done) controller.close();
                else controller.enqueue(value);
            },
            cancel(reason) {
                xhr.abort();
                return reader?.cancel(reason);
            },
        },
        { highWaterMark: 0 },
    );
}

/**
 * Ask the connection for the credential of a request, for as long as the request is wanted.
 *
 * What is waited for is the resolver of the application, which cannot be stopped, so an abort ends
 * the wait with the reason of the signal and what the resolver comes up with is left to the
 * connection, which keeps it for the requests which follow. An abort wins over a resolver which
 * fails at the same moment: a request which has been abandoned is not told that its credential
 * could not be resolved.
 */
async function resolveToken(
    source: CredentialSource,
    session: Session,
    rejected: Token | undefined,
    signal: AbortSignal | undefined,
): Promise<Token | undefined> {
    try {
        return await raceAbort(source.token(session, rejected, signal), signal);
    } catch (error) {
        throwIfAborted(signal);
        throw error;
    }
}

/**
 * Let go of a stream which was to be uploaded, but will not be, because the request failed before
 * anything was sent. It is cancelled with the reason, which a stream that has been cancelled
 * already, by the abort which caused the failure, takes no further notice of.
 */
function discardBody(body: BodyInit | undefined, reason: unknown): void {
    if (body instanceof ReadableStream) {
        body.cancel(reason).catch(() => {});
    }
}

function originOf(url: URL): string {
    const normalized = new URL(url);

    normalized.protocol = normalized.protocol.replace("ws", "http");

    return normalized.origin;
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
