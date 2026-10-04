import type { Uuid } from "@surrealdb/sqon";
import {
    ConnectionUnavailableError,
    MissingNamespaceDatabaseError,
    SurrealSqonError,
    UnexpectedServerResponseError,
    UnsupportedFeatureError,
} from "../errors";
import { buildRpcAuth } from "../internal/build-rpc-auth";
import { getSessionFromState } from "../internal/get-session-from-state";
import { fetchSurreal } from "../internal/http";
import { parseRpcError } from "../internal/parse-error";
import { wrapSqonError } from "../internal/wrap-sqon-error";
import type { AnyAuth, AuthOrToken, RpcQueryResult } from "../types";
import type { LiveMessage } from "../types/live";
import type { RpcRequest, RpcResponse } from "../types/rpc";
import type {
    ConnectionState,
    EngineEvents,
    QueryChunk,
    Session,
    SurrealEngine,
} from "../types/surreal";
import type { BoundQuery } from "../utils";
import { Features } from "../utils";
import { Publisher } from "../utils/publisher";
import { RpcEngine } from "./rpc";

const ALWAYS_ALLOW = new Set([
    "use",
    "signin",
    "signup",
    "authenticate",
    "version",
    "query",
    "info",
    "health",
]);

// Requests which establish the credentials of a session, or which do not need any. These
// never trigger the resolution of per-request credentials.
const NEVER_RESOLVE = new Set([
    "signin",
    "signup",
    "authenticate",
    "refresh",
    "revoke",
    "version",
    "health",
]);

interface SendOptions {
    /** Present this credential with the request, in place of the one of the session */
    credential?: AuthOrToken;
    /** Present no credential with the request, not even the one of the session */
    anonymous?: boolean;
}

/**
 * An engine that communicates by sending individual HTTP requests
 */
export class HttpEngine extends RpcEngine implements SurrealEngine {
    #publisher = new Publisher<EngineEvents>();

    features = new Set([
        Features.RefreshTokens,
        Features.Api,
        Features.ExportImportRaw,
        Features.SurrealML,
        Features.PerRequestAuth,
    ]);

    subscribe<K extends keyof EngineEvents>(
        event: K,
        listener: (...payload: EngineEvents[K]) => void,
    ): () => void {
        return this.#publisher.subscribe(event, listener);
    }

    open(state: ConnectionState): void {
        this._state = state;
        setTimeout(() => {
            this.#publisher.publish("connected");
        });
    }

    async close(): Promise<void> {
        this._state = undefined;
        this.#publisher.publish("disconnected");
    }

    ready(): void {
        // No-op for HTTP engine - no pending calls to resend
    }

    /**
     * Run a query as someone else. The credential is presented with this request alone, and
     * the session is neither used for authentication nor changed.
     */
    async *queryAs<T>(
        query: BoundQuery,
        session: Session,
        txn: Uuid | undefined,
        credential: AuthOrToken,
    ): AsyncIterable<QueryChunk<T>> {
        const responses: RpcQueryResult[] = await this.send(
            {
                method: "query",
                params: [query.query, query.bindings],
                session,
                txn,
            },
            { credential },
        );

        yield* this.toChunks<T>(responses);
    }

    /**
     * Exchange authentication details for a token, with nothing but the details to go on.
     */
    async #exchange(auth: AnyAuth, session: Session, state: ConnectionState): Promise<string> {
        const response = await this.send(
            {
                method: "signin",
                params: [buildRpcAuth(getSessionFromState(state, session), auth)],
                session,
            },
            { anonymous: true },
        );

        return this.parseTokens(response).access;
    }

    override async send<Method extends string, Params extends unknown[] | undefined, Result>(
        request: RpcRequest<Method, Params>,
        options?: SendOptions,
    ): Promise<Result> {
        const state = this._state;

        if (!state) {
            throw new ConnectionUnavailableError();
        }

        // Unsupported by the HTTP protocol
        switch (request.method) {
            case "use":
            case "let":
            case "unset":
            case "reset":
            case "invalidate": {
                // if this is an empty use call, then that means we are
                // to try and retrieve a default namespace and database
                if (request.method === "use" && isEmptyUseParams(request.params)) {
                    break;
                }

                return undefined as unknown as Result;
            }
        }

        const session = getSessionFromState(state, request.session);

        if ((!session.namespace || !session.database) && !ALWAYS_ALLOW.has(request.method)) {
            throw new MissingNamespaceDatabaseError();
        }

        switch (request.method) {
            case "query": {
                request.params = [
                    request.params?.[0],
                    {
                        ...session.variables,
                        ...(request.params?.[1] ?? {}),
                    },
                ] as Params;
                break;
            }
        }

        // The credential of a single request is neither stored nor sent in the body of the
        // request. Authentication details are exchanged for a token without touching the session,
        // and without presenting the credential of the session while doing so.
        let token: string | undefined;

        if (options?.anonymous) {
            token = "";
        } else if (options?.credential !== undefined) {
            token =
                typeof options.credential === "string"
                    ? options.credential
                    : await this.#exchange(options.credential, request.session, state);
        }

        const id = this._context.uniqueId();
        const res = await fetchSurreal(this._context, state, session, {
            body: {
                id,
                ...request,
            },
            token,
            resolve: !NEVER_RESOLVE.has(request.method),
        });

        const buffer = await res.arrayBuffer();

        let response: RpcResponse<Result>;

        try {
            response = wrapSqonError(() =>
                this._context.codecs.cbor.decode<RpcResponse<Result>>(new Uint8Array(buffer)),
            );
        } catch (error) {
            if (error instanceof SurrealSqonError) {
                throw error;
            }

            throw new UnexpectedServerResponseError(error);
        }

        if (response.error) {
            throw parseRpcError(response.error);
        }

        return response.result;
    }

    override liveQuery(): AsyncIterable<LiveMessage> {
        throw new UnsupportedFeatureError(Features.LiveQueries);
    }
}

function isEmptyUseParams(params?: unknown[]): boolean {
    return (
        Array.isArray(params) &&
        typeof params[0] === "undefined" &&
        typeof params[1] === "undefined"
    );
}
