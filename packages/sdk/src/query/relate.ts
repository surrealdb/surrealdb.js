import { type DateTime, type Duration, RecordId, type Table, type Uuid } from "@surrealdb/sqon";
import type { ConnectionController } from "../controller";
import { ExpressionError, SurrealError } from "../errors";
import { type AbortOptions, addSignal, assertTimeout } from "../internal/abort";
import { DispatchedPromise } from "../internal/dispatched-promise";
import { _output, _timeout } from "../internal/internal-expressions";
import type { MaybeJsonify } from "../internal/maybe-jsonify";
import type { AnyRecordId, Output, RetryValue, Session } from "../types";
import { type BoundQuery, surql } from "../utils";
import type { Frame, StreamedRow } from "../utils/frame";
import { Query } from "./query";

interface RelateOptions extends AbortOptions {
    from: AnyRecordId | AnyRecordId[];
    what: Table | RecordId;
    to: AnyRecordId | AnyRecordId[];
    unique?: boolean;
    output?: Output;
    timeout?: Duration;
    version?: DateTime;
    data?: unknown;
    transaction: Uuid | undefined;
    session: Session;
    retry?: RetryValue;
    json: boolean;
}

/**
 * A configurable `Promise` for a relate query sent to a SurrealDB instance.
 */
export class RelatePromise<T, J extends boolean = false> extends DispatchedPromise<
    MaybeJsonify<T, J>
> {
    #connection: ConnectionController;
    #options: RelateOptions;

    constructor(connection: ConnectionController, options: RelateOptions) {
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
    json(): RelatePromise<T, true> {
        return new RelatePromise<T, true>(this.#connection, {
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
     * await db.relate(from, 'likes', to).retry();
     * ```
     *
     * @param options Retry behavior. Defaults to enabling retry using the connection defaults.
     * @returns A new `RelatePromise` configured to retry on conflict.
     */
    retry(options: RetryValue = true): RelatePromise<T, J> {
        return new RelatePromise<T, J>(this.#connection, {
            ...this.#options,
            retry: options,
        });
    }

    /**
     * Configure the query to enforce a unique relationship
     */
    unique(): RelatePromise<T, J> {
        return new RelatePromise<T, J>(this.#connection, {
            ...this.#options,
            unique: true,
        });
    }

    /**
     * Configure the output of the query
     */
    output(output: Output): RelatePromise<T, J> {
        return new RelatePromise<T, J>(this.#connection, {
            ...this.#options,
            output,
        });
    }

    /**
     * Configure the timeout of the query
     */
    timeout(timeout: Duration): RelatePromise<T, J> {
        return new RelatePromise<T, J>(this.#connection, {
            ...this.#options,
            timeout,
        });
    }

    /**
     * Configure a custom version of the data being created.
     *
     * @deprecated SurrealDB has no `VERSION` clause for `RELATE` statements, so
     * a query using this method fails with an `ExpressionError` when it is
     * compiled or executed, before anything is sent to the server.
     */
    version(version: DateTime): RelatePromise<T, J> {
        return new RelatePromise<T, J>(this.#connection, {
            ...this.#options,
            version,
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
     * const result = await db.relate(from, edge, to).signal(request.signal);
     * ```
     *
     * @param signal The signal which abandons the query. Without one, nothing changes.
     */
    signal(signal: AbortSignal | undefined): RelatePromise<T, J> {
        return new RelatePromise<T, J>(this.#connection, {
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
    requestTimeout(milliseconds: number): RelatePromise<T, J> {
        assertTimeout(milliseconds, "requestTimeout");

        return new RelatePromise<T, J>(this.#connection, {
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
        const {
            from,
            what,
            to,
            data,
            transaction,
            session,
            json,
            output,
            timeout,
            version,
            retry,
        } = this.#options;

        if (version) {
            throw new ExpressionError("The VERSION clause is not supported by RELATE statements");
        }

        const isMultiple = Array.isArray(from) || Array.isArray(to);

        if (isMultiple && what instanceof RecordId) {
            throw new SurrealError("Edge must be a table when creating multiple edges");
        }

        const query = surql`RELATE `;

        if (!isMultiple) {
            query.append(surql` ONLY`);
        }

        query.append(surql` ${from}->${what}->${to}`);

        if (data) {
            query.append(surql` CONTENT ${data}`);
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
