import {
    ConnectionUnavailableError,
    MissingNamespaceDatabaseError,
    ResponseError,
    SurrealError,
    UnexpectedServerResponseError,
} from "../errors";
import { getSessionFromState } from "../internal/get-session-from-state";
import { fetchSurreal } from "../internal/http";
import type { LiveMessage } from "../types/live";
import type { RpcRequest, RpcResponse } from "../types/rpc";
import type { ConnectionState, EngineEvents, SurrealEngine } from "../types/surreal";
import { Features } from "../utils";
import { Publisher } from "../utils/publisher";
import { RpcEngine } from "./rpc";

const ALWAYS_ALLOW = new Set([
    "signin",
    "signup",
    "authenticate",
    "version",
    "query",
    "info",
    "health",
]);

/**
 * An engine that communicates by sending individual HTTP requests
 */
export class HttpEngine extends RpcEngine implements SurrealEngine {
    #publisher = new Publisher<EngineEvents>();

    features = new Set([Features.RefreshTokens, Features.Sessions]);

    subscribe<K extends keyof EngineEvents>(
        event: K,
        listener: (...payload: EngineEvents[K]) => void,
    ): () => void {
        return this.#publisher.subscribe(event, listener);
    }

    open(state: ConnectionState): void {
        this._state = state;
        this.#publisher.publish("connected");
    }

    async close(): Promise<void> {
        this._state = undefined;
        this.#publisher.publish("disconnected");
    }

    override async send<Method extends string, Params extends unknown[] | undefined, Result>(
        request: RpcRequest<Method, Params>,
    ): Promise<Result> {
        if (!this._state) {
            throw new ConnectionUnavailableError();
        }

        // Unsupported by the HTTP protocol
        switch (request.method) {
            case "use":
            case "let":
            case "unset":
            case "reset":
            case "invalidate": {
                return undefined as unknown as Result;
            }
        }

        const session = getSessionFromState(this._state, request.session);

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

        const id = this._context.uniqueId();
        const buffer = await fetchSurreal(this._context, this._state, session, {
            body: {
                id,
                ...request,
            },
        });

        try {
            const response = this._context.codecs.cbor.decode<RpcResponse<Result>>(
                new Uint8Array(buffer),
            );

            if (response.error) {
                throw new ResponseError(response.error);
            }

            return response.result;
        } catch (error) {
            throw new UnexpectedServerResponseError(error);
        }
    }

    override liveQuery(): AsyncIterable<LiveMessage> {
        throw new SurrealError("Live queries are not available over HTTP");
    }
}
