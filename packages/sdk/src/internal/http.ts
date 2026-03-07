import { HttpConnectionError } from "../errors";
import type { ConnectionSession, ConnectionState, DriverContext } from "../types/surreal";

export interface FetchSurrealOptions {
    body?: unknown;
    url?: URL;
    headers?: Record<string, string>;
    method?: string;
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

    const encodedBody = encodeBody(context, options.body);
    const response = await fetchImpl(endpoint, {
        method: options.method ?? "POST",
        headers: headerMap,
        body: encodedBody,
        duplex: encodedBody instanceof ReadableStream ? "half" : undefined,
    } as RequestInit);

    if (response.status === 200) {
        return response;
    }

    const buffer = await response.arrayBuffer();

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
    if (body instanceof ReadableStream) {
        return body;
    }

    return body ? context.codecs.cbor.encode(body) : undefined;
}
