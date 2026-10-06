import type { Duration, RecordIdRange, Table, Uuid } from "@surrealdb/sqon";
import type { ConnectionController } from "../controller";
import { type AbortOptions, addSignal, assertTimeout } from "../internal/abort";
import { DispatchedPromise } from "../internal/dispatched-promise";
import { _only, _output, _timeout } from "../internal/internal-expressions";
import type { MaybeJsonify } from "../internal/maybe-jsonify";
import type {
    AnyRecordId,
    Expr,
    ExprLike,
    Mutation,
    Output,
    Patch,
    RetryValue,
    Session,
    Values,
} from "../types";
import { type BoundQuery, raw, surql } from "../utils";
import type { Frame, StreamedRow } from "../utils/frame";
import { Query } from "./query";

interface UpdateOptions extends AbortOptions {
    what: AnyRecordId | RecordIdRange | Table;
    mutation?: Mutation;
    data?: unknown;
    cond?: Expr;
    output?: Output;
    timeout?: Duration;
    transaction: Uuid | undefined;
    session: Session;
    retry?: RetryValue;
    json: boolean;
}

/**
 * A configurable `Promise` for an update query sent to a SurrealDB instance.
 */
export class UpdatePromise<T, I, J extends boolean = false> extends DispatchedPromise<
    MaybeJsonify<T, J>
> {
    #connection: ConnectionController;
    #options: UpdateOptions;

    constructor(connection: ConnectionController, options: UpdateOptions) {
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
    json(): UpdatePromise<T, I, true> {
        return new UpdatePromise<T, I, true>(this.#connection, {
            ...this.#options,
            json: true,
        });
    }

    /**
     * Configure the query to automatically retry when it fails due to a transaction conflict.
     *
     * Under concurrent load a query may fail because another transaction wrote to the same data.
     * When retry is enabled, the entire query is re-sent with exponential backoff until it
     * succeeds or the configured attempts are exhausted.
     *
     * **NOTE:** Retrying re-sends the full query. Only use this for queries that are safe to replay.
     * Re-sending a non-atomic, multi-statement query may apply some statements more than once.
     *
     * @example
     * ```ts
     * const user = await db.update(new RecordId('users', 'john'))
     *     .content({ name: 'John Doe' })
     *     .retry();
     * ```
     *
     * @param options Retry behavior. Defaults to enabling retry using the connection defaults.
     * @returns A new `UpdatePromise` configured to retry on conflict.
     */
    retry(options: RetryValue = true): UpdatePromise<T, I, J> {
        return new UpdatePromise<T, I, J>(this.#connection, {
            ...this.#options,
            retry: options,
        });
    }

    /**
     * Configure the query to set the record data
     */
    content(data: Values<I>): UpdatePromise<T, I, J> {
        return new UpdatePromise<T, I, J>(this.#connection, {
            ...this.#options,
            mutation: "content",
            data,
        });
    }

    /**
     * Configure the query to merge the record data
     */
    merge(data: Values<I>): UpdatePromise<T, I, J> {
        return new UpdatePromise<T, I, J>(this.#connection, {
            ...this.#options,
            mutation: "merge",
            data,
        });
    }

    /**
     * Configure the query to replace the record data
     */
    replace(data: Values<I>): UpdatePromise<T, I, J> {
        return new UpdatePromise<T, I, J>(this.#connection, {
            ...this.#options,
            mutation: "replace",
            data,
        });
    }

    /**
     * Configure the query to patch the record data
     */
    patch(data: Patch[]): UpdatePromise<T, I, J> {
        return new UpdatePromise<T, I, J>(this.#connection, {
            ...this.#options,
            mutation: "patch",
            data,
        });
    }

    /**
     * Configure the query to update the record only if the condition is met.
     *
     * Expressions can be imported from the `surrealdb` package and combined
     * to compose the desired condition.
     *
     * @see {@link https://github.com/surrealdb/surrealdb.js/blob/main/packages/sdk/src/utils/expr.ts}
     */
    where(expr: ExprLike): UpdatePromise<T, I, J> {
        return new UpdatePromise<T, I, J>(this.#connection, {
            ...this.#options,
            cond: expr ? expr : undefined,
        });
    }

    /**
     * Configure the output of the query
     */
    output(output: Output): UpdatePromise<T, I, J> {
        return new UpdatePromise<T, I, J>(this.#connection, {
            ...this.#options,
            output,
        });
    }

    /**
     * Configure the timeout of the query
     */
    timeout(timeout: Duration): UpdatePromise<T, I, J> {
        return new UpdatePromise<T, I, J>(this.#connection, {
            ...this.#options,
            timeout,
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
     * const result = await db.update(id).merge(data).signal(request.signal);
     * ```
     *
     * @param signal The signal which abandons the query. Without one, nothing changes.
     */
    signal(signal: AbortSignal | undefined): UpdatePromise<T, I, J> {
        return new UpdatePromise<T, I, J>(this.#connection, {
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
    requestTimeout(milliseconds: number): UpdatePromise<T, I, J> {
        assertTimeout(milliseconds, "requestTimeout");

        return new UpdatePromise<T, I, J>(this.#connection, {
            ...this.#options,
            requestTimeout: milliseconds,
        });
    }

    /**
     * Compile this qurery into a BoundQuery
     */
    compile(): BoundQuery<[T]> {
        return this.#build().inner;
    }

    /**
     * Stream the results of the query as they are received.
     *
     * @returns An async iterable of query frames.
     */
    async *stream(): AsyncIterable<Frame<StreamedRow<T>, J>> {
        const query = this.#build().stream<StreamedRow<T>>();

        for await (const frame of query) {
            yield frame;
        }
    }

    protected async dispatch(): Promise<MaybeJsonify<T, J>> {
        const [result] = await this.#build().collect();
        return result;
    }

    #build(): Query<[T], J> {
        const { what, data, transaction, session, json, cond, output, timeout, mutation, retry } =
            this.#options;

        const query = surql`UPDATE ${_only(what)}`;

        if (mutation && data) {
            query.append(surql` ${raw(mutation.toUpperCase())} ${data}`);
        }

        if (cond) {
            query.append(surql` WHERE ${cond}`);
        }

        if (output) {
            query.append(surql` RETURN ${_output(output)}`);
        }

        if (timeout) {
            query.append(surql` TIMEOUT ${_timeout(timeout)}`);
        }

        return new Query(this.#connection, {
            retry,
            query,
            transaction,
            json,
            session,
            signals: this.#options.signals,
            requestTimeout: this.#options.requestTimeout,
        });
    }
}
