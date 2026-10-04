import { HttpConnectionError } from "../errors";
import type { ConnectionSession, ConnectionState, DriverContext } from "../types/surreal";
import { raceAbort, throwIfAborted } from "./abort";
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

/** Release a response nobody is going to read */
function discardResponse(response: Response): void {
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

    const encodedBody = encodeBody(context, options.body);
    const response = await raceAbort(
        fetchImpl(endpoint, {
            method: options.method ?? "POST",
            headers: headerMap,
            body: encodedBody,
            signal: options.signal,
            // @ts-expect-error TS is dumb
            duplex: "half",
        }),
        options.signal,
        discardResponse,
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

function encodeBody(context: DriverContext, body?: unknown): BodyInit | undefined {
    if (body instanceof ReadableStream || body instanceof Blob) {
        return body;
    }

    return body ? new Uint8Array(wrapSqonError(() => context.codecs.cbor.encode(body))) : undefined;
}
