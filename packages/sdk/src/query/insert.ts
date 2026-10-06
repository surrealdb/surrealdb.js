import type { DateTime, Duration, Table, Uuid } from "@surrealdb/sqon";
import type { ConnectionController } from "../controller";
import { type AbortOptions, addSignal, assertTimeout } from "../internal/abort";
import { assertCredential } from "../internal/auth-provider";
import { DispatchedPromise } from "../internal/dispatched-promise";
import { _output, _timeout } from "../internal/internal-expressions";
import type { MaybeJsonify } from "../internal/maybe-jsonify";
import type { AuthOrToken, Output, RetryValue, Session } from "../types";
import { type BoundQuery, surql } from "../utils";
import type { Frame, StreamedRow } from "../utils/frame";
import { Query } from "./query";

interface InsertOptions extends AbortOptions {
    table: Table | undefined;
    what: unknown | unknown[];
    relation?: boolean;
    ignore?: boolean;
    output?: Output;
    timeout?: Duration;
    version?: DateTime;
    transaction: Uuid | undefined;
    session: Session;
    retry?: RetryValue;
    credential?: AuthOrToken;
    json: boolean;
}

/**
 * A configurable `Promise` for an insert query sent to a SurrealDB instance.
 */
export class InsertPromise<T, J extends boolean = false> extends DispatchedPromise<
    MaybeJsonify<T, J>
> {
    #connection: ConnectionController;
    #options: InsertOptions;

    constructor(connection: ConnectionController, options: InsertOptions) {
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
    json(): InsertPromise<T, true> {
        return new InsertPromise<T, true>(this.#connection, {
            ...this.#options,
            json: true,
        });
    }

    /**
     * Run this call as a different identity than the one of the session, for this call only.
     * The session is neither used nor changed. Supported by engines which present credentials
     * with every request, such as HTTP, and rejected with an `UnsupportedFeatureError` by
     * the others.
     *
     * @see {@link Query.as} for details.
     *
     * @param credential An access token or authentication details to run this call as
     * @returns A new `InsertPromise` which runs as the provided identity.
     */
    as(credential: AuthOrToken): InsertPromise<T, J> {
        assertCredential(credential);

        return new InsertPromise<T, J>(this.#connection, {
            ...this.#options,
            credential,
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
     * await db.insert({ name: 'John Doe' }).retry();
     * ```
     *
     * @param options Retry behavior. Defaults to enabling retry using the connection defaults.
     * @returns A new `InsertPromise` configured to retry on conflict.
     */
    retry(options: RetryValue = true): InsertPromise<T, J> {
        return new InsertPromise<T, J>(this.#connection, {
            ...this.#options,
            retry: options,
        });
    }

    /**
     * Configure the query to insert a relation instead of a regular record
     */
    relation(): InsertPromise<T, J> {
        return new InsertPromise<T, J>(this.#connection, {
            ...this.#options,
            relation: true,
        });
    }

    /**
     * Configure the query to ignore records if they already exist
     */
    ignore(): InsertPromise<T, J> {
        return new InsertPromise<T, J>(this.#connection, {
            ...this.#options,
            ignore: true,
        });
    }

    /**
     * Configure the output of the query
     */
    output(output: Output): InsertPromise<T, J> {
        return new InsertPromise<T, J>(this.#connection, {
            ...this.#options,
            output,
        });
    }

    /**
     * Configure the timeout of the query
     */
    timeout(timeout: Duration): InsertPromise<T, J> {
        return new InsertPromise<T, J>(this.#connection, {
            ...this.#options,
            timeout,
        });
    }

    /**
     * Configure a custom version of the data being created. This is used
     * alongside version enabled storage engines such as SurrealKV.
     */
    version(version: DateTime): InsertPromise<T, J> {
        return new InsertPromise<T, J>(this.#connection, {
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
     * const result = await db.insert(table, data).signal(request.signal);
     * ```
     *
     * @param signal The signal which abandons the query. Without one, nothing changes.
     */
    signal(signal: AbortSignal | undefined): InsertPromise<T, J> {
        return new InsertPromise<T, J>(this.#connection, {
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
    requestTimeout(milliseconds: number): InsertPromise<T, J> {
        assertTimeout(milliseconds, "requestTimeout");

        return new InsertPromise<T, J>(this.#connection, {
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
            table,
            what,
            transaction,
            session,
            json,
            output,
            timeout,
            version,
            relation,
            ignore,
            retry,
        } = this.#options;

        const query = surql`INSERT`;

        if (relation) {
            query.append(surql` RELATION`);
        }

        if (ignore) {
            query.append(surql` IGNORE`);
        }

        if (table) {
            query.append(surql` INTO ${table}`);
        }

        query.append(surql` ${what}`);

        if (output) {
            query.append(surql` RETURN ${_output(output)}`);
        }

        if (version) {
            query.append(surql` VERSION ${version}`);
        }

        if (timeout) {
            query.append(surql` TIMEOUT ${_timeout(timeout)}`);
        }

        return new Query(this.#connection, {
            credential: this.#options.credential,
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
