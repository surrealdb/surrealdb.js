import type { Uuid } from "@surrealdb/sqon";
import type { ConnectionController } from "../controller";
import { SurrealError, UnsuccessfulApiError } from "../errors";
import { type AbortOptions, addSignal, assertTimeout } from "../internal/abort";
import { DispatchedPromise } from "../internal/dispatched-promise";
import type { MaybeJsonify } from "../internal/maybe-jsonify";
import type { Session } from "../types";
import { type BoundQuery, surql } from "../utils";
import type { Frame } from "../utils/frame";
import { Query } from "./query";

/**
 * The response information for an api request.
 */
export interface ApiResponse<T> {
    body?: T;
    headers?: Record<string, string>;
    status?: number;
}

type Result<Res, V extends boolean> = V extends true ? Res : ApiResponse<Res>;
type Collect<Res, V extends boolean, J extends boolean> = MaybeJsonify<Result<Res, V>, J>;

interface ApiOptions<Req> extends AbortOptions {
    path: string;
    body?: Req;
    method: string;
    headers: Record<string, string>;
    query: Record<string, string>;
    transaction: Uuid | undefined;
    session: Session;
    value: boolean;
    json: boolean;
}

/**
 * A configurable `Promise` for an api request sent to a SurrealDB instance.
 */
export class ApiPromise<
    Req,
    Res,
    V extends boolean = false,
    J extends boolean = false,
> extends DispatchedPromise<Collect<Res, V, J>> {
    #connection: ConnectionController;
    #options: ApiOptions<Req>;

    constructor(connection: ConnectionController, options: ApiOptions<Req>) {
        super();
        this.#connection = connection;
        this.#options = options;
    }

    /**
     * Configure the query to return the result as a
     * JSON-compatible structure.
     *
     * This is useful when query results need to be serialized. Keep in mind
     * that your responses will lose SurrealDB type information.
     */
    json(): ApiPromise<Req, Res, true> {
        return new ApiPromise<Req, Res, true>(this.#connection, {
            ...this.#options,
            json: true,
        });
    }

    /**
     * Append a header to the api request.
     *
     * @param name The name of the header to append.
     * @param value The value of the header to append.
     */
    header(name: string, value: string): ApiPromise<Req, Res, J> {
        return new ApiPromise<Req, Res, J>(this.#connection, {
            ...this.#options,
            headers: { ...this.#options.headers, [name]: value },
        });
    }

    /**
     * Append a query parameter to the api request.
     *
     * @param name The name of the query parameter to append.
     * @param value The value of the query parameter to append.
     * @returns A new ApiPromise instance.
     */
    query(name: string, value: string): ApiPromise<Req, Res, J> {
        return new ApiPromise<Req, Res, J>(this.#connection, {
            ...this.#options,
            query: { ...this.#options.query, [name]: value },
        });
    }

    /**
     * Configure the query to return the response body value
     * as the result. If the response status is not 200, the promise will reject.
     */
    value(): ApiPromise<Req, Res, true, J> {
        return new ApiPromise<Req, Res, true, J>(this.#connection, {
            ...this.#options,
            value: true,
        });
    }

    /**
     * Configure the query to be abandoned when a signal aborts.
     *
     * If the signal has already aborted, the query is not sent and fails straight away. If it aborts
     * later, the query stops waiting for the server and fails with the `reason` of the signal, as it
     * is: an `AbortError`, or the `TimeoutError` of `AbortSignal.timeout()`. This holds for awaiting
     * the query as well as for `.stream()`, which ends its iteration with the reason.
     *
     * Aborting means "stop waiting", and nothing more. The server may keep executing the query, and
     * **a write which was sent before the signal aborted may or may not have been applied**.
     *
     * Can be called more than once, and in addition to a signal inherited from `withSignal()`: the
     * query is abandoned when any of them aborts. See {@link Query.signal}.
     *
     * @example
     * ```ts
     * const result = await db.api().get("/report").signal(request.signal);
     * ```
     *
     * @param signal The signal which abandons the query. Without one, nothing changes.
     */
    signal(signal: AbortSignal | undefined): ApiPromise<Req, Res, V, J> {
        return new ApiPromise<Req, Res, V, J>(this.#connection, {
            ...this.#options,
            signals: addSignal(this.#options.signals, signal),
        });
    }

    /**
     * Configure how long to wait for the server to answer the query, in milliseconds, before giving
     * up on it with a `TimeoutError`. Overrides the `requestTimeout` of the connection for this
     * query, so it can also allow a query longer than that default, or `0` to wait without limit.
     *
     * This is a limit on the client, and not the `TIMEOUT` clause which the server enforces and
     * which is set with `.timeout()`. The server is not told the client has given up, so **a write
     * which timed out may or may not have been applied**. See {@link Query.requestTimeout}.
     *
     * @param milliseconds The time to wait for an answer, or `0` for no limit.
     */
    requestTimeout(milliseconds: number): ApiPromise<Req, Res, V, J> {
        assertTimeout(milliseconds, "requestTimeout");

        return new ApiPromise<Req, Res, V, J>(this.#connection, {
            ...this.#options,
            requestTimeout: milliseconds,
        });
    }

    /**
     * Compile this qurery into a BoundQuery
     */
    compile(): BoundQuery<[ApiResponse<Res>]> {
        return this.#build().inner;
    }

    /**
     * Stream the results of the query as they are received.
     *
     * @returns An async iterable of query frames.
     */
    async *stream(): AsyncIterable<Frame<ApiResponse<Res>, J>> {
        const query = this.#build().stream<ApiResponse<Res>>();

        for await (const frame of query) {
            yield frame;
        }
    }

    protected async dispatch(): Promise<Collect<Res, V, J>> {
        const [result] = await this.#build().collect();

        if (!("body" in result) || typeof result.status !== "number") {
            throw new SurrealError("Body or status was missing from the API response");
        }

        if (this.#options.value) {
            if ("status" in result && !isSuccessful(result.status)) {
                throw new UnsuccessfulApiError(this.#options.path, this.#options.method, result);
            }

            return result.body as Collect<Res, V, J>;
        }

        return result as Collect<Res, V, J>;
    }

    #build(): Query<[ApiResponse<Res>], J> {
        const { path, body, method, headers, query, transaction, session, json } = this.#options;

        return new Query(this.#connection, {
            transaction,
            json,
            session,
            query: surql`api::invoke(${path}, ${{
                body,
                method,
                headers,
                query,
            }})`,
            signals: this.#options.signals,
            requestTimeout: this.#options.requestTimeout,
        });
    }
}

function isSuccessful(status: number): boolean {
    return status >= 200 && status < 300;
}
