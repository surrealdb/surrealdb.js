import { HttpConnectionError, SurrealError } from "../errors";
import type { Token } from "../types/auth";
import type { ConnectionSession, ConnectionState, DriverContext } from "../types/surreal";
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

    // A credential which is decided for a single request is only ever presented to the
    // connection it was resolved for, and never follows a redirect elsewhere.
    const source =
        options.token === undefined && options.resolve !== false ? state.credentials : undefined;
    const scoped = options.token !== undefined || source !== undefined;

    if (scoped && endpoint.origin !== originOf(state.url)) {
        throw new SurrealError("Request credentials are only sent to the origin of the connection");
    }

    let token = options.token ?? session.accessToken;

    if (source) {
        token = await source.token(session.id);
    }

    const encodedBody = encodeBody(context, options.body);
    const attempt = (bearer: Token | undefined): Promise<Response> => {
        const headers = bearer ? { ...headerMap, Authorization: `Bearer ${bearer}` } : headerMap;

        return fetchImpl(endpoint, {
            method: options.method ?? "POST",
            headers,
            body: encodedBody,
            ...(scoped ? { redirect: "manual" as const } : {}),
            // @ts-expect-error TS is dumb
            duplex: "half",
        });
    };

    let response = await attempt(token);

    // The server answers 401 to a token it does not accept, such as one which has expired, before
    // it executes anything. This is the one rejection which is known to not have been applied, so
    // it is safe to ask for a new credential and send the request again, once, whatever the
    // request does. A body which has been streamed out cannot be sent again.
    if (response.status === 401 && source && token && !(encodedBody instanceof ReadableStream)) {
        const renewed = await source.token(session.id, token);

        if (renewed && renewed !== token) {
            await response.body?.cancel().catch(() => {});
            response = await attempt(renewed);
        }
    }

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

function encodeBody(context: DriverContext, body?: unknown): BodyInit | undefined {
    if (body instanceof ReadableStream || body instanceof Blob) {
        return body;
    }

    return body ? new Uint8Array(wrapSqonError(() => context.codecs.cbor.encode(body))) : undefined;
}
