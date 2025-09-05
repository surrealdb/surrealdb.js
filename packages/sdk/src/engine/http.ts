import {
    ConnectionUnavailable,
    MissingNamespaceDatabase,
    ResponseError,
    SurrealError,
} from "../errors";
import { getIncrementalID } from "../internal/get-incremental-id";
import { fetchSurreal } from "../internal/http";
import type { LiveMessage } from "../types/live";
import type { RpcRequest, RpcResponse } from "../types/rpc";
import type { ConnectionState, EngineEvents, SurrealEngine } from "../types/surreal";
import { Publisher } from "../utils/publisher";
import { JsonEngine } from "./json";

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
export class HttpEngine extends JsonEngine implements SurrealEngine {
    #publisher = new Publisher<EngineEvents>();

    subscribe<K extends keyof EngineEvents>(
        event: K,
        listener: (...payload: EngineEvents[K]) => void,
    ): () => void {
        return this.#publisher.subscribe(event, listener);
    }

    open(state: ConnectionState): void {
        this.#publisher.publish("connecting");
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
            throw new ConnectionUnavailable();
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

        if (
            (!this._state.namespace || !this._state.database) &&
            !ALWAYS_ALLOW.has(request.method)
        ) {
            throw new MissingNamespaceDatabase();
        }

        switch (request.method) {
            case "query": {
                request.params = [
                    request.params?.[0],
                    {
                        ...this._state.variables,
                        ...(request.params?.[1] ?? {}),
                    },
                ] as Params;
                break;
            }
        }

        const id = getIncrementalID();
        const buffer = await fetchSurreal(this._context, this._state, {
            body: {
                id,
                ...request,
            },
        });

        const response = this._context.decode<RpcResponse<Result>>(new Uint8Array(buffer));

        if (response.error) {
            throw new ResponseError(response.error);
        }

        return response.result;
    }

    override liveQuery(): AsyncIterable<LiveMessage> {
        throw new SurrealError("Live queries are not available over HTTP");
    }
}
