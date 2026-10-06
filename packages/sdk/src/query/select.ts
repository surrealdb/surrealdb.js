import type { DateTime, Duration, RecordIdRange, Table, Uuid } from "@surrealdb/sqon";
import type { ConnectionController } from "../controller";
import { type AbortOptions, addSignal, assertTimeout } from "../internal/abort";
import { assertCredential } from "../internal/auth-provider";
import { DispatchedPromise } from "../internal/dispatched-promise";
import { _only, _timeout } from "../internal/internal-expressions";
import type { MaybeJsonify } from "../internal/maybe-jsonify";
import type { AnyRecordId, AuthOrToken, Expr, ExprLike, Session } from "../types";
import type { Field, Selection } from "../types/internal";
import { type BoundQuery, surql } from "../utils";
import type { Frame, StreamedRow } from "../utils/frame";
import { Query } from "./query";

interface SelectOptions extends AbortOptions {
    what: AnyRecordId | RecordIdRange | Table;
    fields?: string[];
    selection?: Selection;
    start?: number;
    limit?: number;
    cond?: Expr;
    fetch?: string[];
    timeout?: Duration;
    version?: DateTime;
    transaction: Uuid | undefined;
    session: Session;
    credential?: AuthOrToken;
    json: boolean;
}

/**
 * A configurable `Promise` for a select query sent to a SurrealDB instance.
 */
export class SelectPromise<T, I, J extends boolean = false> extends DispatchedPromise<
    MaybeJsonify<T, J>
> {
    #connection: ConnectionController;
    #options: SelectOptions;

    constructor(connection: ConnectionController, options: SelectOptions) {
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
    json(): SelectPromise<T, I, true> {
        return new SelectPromise(this.#connection, {
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
     * @returns A new `SelectPromise` which runs as the provided identity.
     */
    as(credential: AuthOrToken): SelectPromise<T, I, J> {
        assertCredential(credential);

        return new SelectPromise<T, I, J>(this.#connection, {
            ...this.#options,
            credential,
        });
    }

    /**
     * Configure the query to only select the specified field(s)
     */
    fields(...fields: Field<I>[]): SelectPromise<T, I, J> {
        return new SelectPromise(this.#connection, {
            ...this.#options,
            fields: fields as string[],
            selection: "fields",
        });
    }

    /**
     * Configure the query to retrieve the value of the specified field
     */
    value(field: Field<I>): SelectPromise<T, I, J> {
        return new SelectPromise(this.#connection, {
            ...this.#options,
            fields: [field as string],
            selection: "value",
        });
    }

    /**
     * Configure the query to start at the specified index
     */
    start(start: number): SelectPromise<T, I, J> {
        return new SelectPromise(this.#connection, {
            ...this.#options,
            start,
        });
    }

    /**
     * Configure the query to limit the number of results
     */
    limit(limit: number): SelectPromise<T, I, J> {
        return new SelectPromise(this.#connection, {
            ...this.#options,
            limit,
        });
    }

    /**
     * Configure the query to fetch only records that match the condition.
     *
     * Expressions can be imported from the `surrealdb` package and combined
     * to compose the desired condition.
     *
     * @see {@link https://github.com/surrealdb/surrealdb.js/blob/main/packages/sdk/src/utils/expr.ts}
     */
    where(expr: ExprLike): SelectPromise<T, I, J> {
        return new SelectPromise(this.#connection, {
            ...this.#options,
            cond: expr ? expr : undefined,
        });
    }

    /**
     * Configure the query to fetch record link contents for the specified field(s)
     */
    fetch(...fields: Field<I>[]): SelectPromise<T, I, J> {
        return new SelectPromise(this.#connection, {
            ...this.#options,
            fetch: fields as string[],
        });
    }

    /**
     * Configure the timeout of the query
     */
    timeout(timeout: Duration): SelectPromise<T, I, J> {
        return new SelectPromise(this.#connection, {
            ...this.#options,
            timeout,
        });
    }

    /**
     * Configure a custom version of the data being created. This is used
     * alongside version enabled storage engines such as SurrealKV.
     */
    version(version: DateTime): SelectPromise<T, I, J> {
        return new SelectPromise(this.#connection, {
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
     * const result = await db.select(table).signal(request.signal);
     * ```
     *
     * @param signal The signal which abandons the query. Without one, nothing changes.
     */
    signal(signal: AbortSignal | undefined): SelectPromise<T, I, J> {
        return new SelectPromise<T, I, J>(this.#connection, {
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
    requestTimeout(milliseconds: number): SelectPromise<T, I, J> {
        assertTimeout(milliseconds, "requestTimeout");

        return new SelectPromise<T, I, J>(this.#connection, {
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
            what,
            transaction,
            session,
            json,
            selection,
            fields,
            start,
            limit,
            cond,
            timeout,
            version,
            fetch,
        } = this.#options;

        const query = surql`SELECT`;

        if (selection === "fields") {
            query.append(surql` type::fields(${fields})`);
        } else if (selection === "value") {
            query.append(surql` VALUE type::field(${fields?.[0]})`);
        } else {
            query.append(surql` *`);
        }

        query.append(surql` FROM ${_only(what)}`);

        if (cond) {
            query.append(surql` WHERE ${cond}`);
        }

        if (start) {
            query.append(surql` START ${start}`);
        }

        if (limit) {
            query.append(surql` LIMIT ${limit}`);
        }

        if (fetch) {
            query.append(surql` FETCH type::fields(${fetch})`);
        }

        if (version) {
            query.append(surql` VERSION ${version}`);
        }

        if (timeout) {
            query.append(surql` TIMEOUT ${_timeout(timeout)}`);
        }

        return new Query(this.#connection, {
            credential: this.#options.credential,
            query,
            transaction,
            json,
            session,
            signals: this.#options.signals,
            requestTimeout: this.#options.requestTimeout,
        });
    }
}
