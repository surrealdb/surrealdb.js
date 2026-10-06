import { HttpConnectionError, SurrealError } from "../errors";
import type { Token } from "../types/auth";
import type {
    ConnectionSession,
    ConnectionState,
    CredentialSource,
    DriverContext,
    Session,
} from "../types/surreal";
import { raceAbort, throwIfAborted } from "./abort";
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

    let token = options.token ?? session.accessToken;

    if (source) {
        token = await resolveToken(source, session.id, undefined, options.signal);
    }

    const encodedBody = encodeBody(context, options.body);
    const attempt = (bearer: Token | undefined): Promise<Response> => {
        const headers = bearer ? { ...headerMap, Authorization: `Bearer ${bearer}` } : headerMap;

        return raceAbort(
            fetchImpl(endpoint, {
                ...context.options.fetchOptions,
                method: options.method ?? "POST",
                headers,
                body: encodedBody,
                ...(scoped ? { redirect: "manual" as const } : {}),
                signal: options.signal,
                // @ts-expect-error TS is dumb
                duplex: "half",
            }),
            options.signal,
            discardResponse,
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
            discardResponse(response);
            response = await attempt(renewed);
        }
    }

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
