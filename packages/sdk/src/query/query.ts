import type { Uuid } from "@surrealdb/sqon";
import type { ConnectionController } from "../controller";
import type { ServerError } from "../errors";
import {
    type AbortOptions,
    abortableIterable,
    abortScope,
    addSignal,
    assertTimeout,
    raceAbort,
    throwIfAborted,
} from "../internal/abort";
import { DispatchedPromise } from "../internal/dispatched-promise";
import { type MaybeJsonify, maybeJsonify } from "../internal/maybe-jsonify";
import { RetryContext } from "../internal/retry";
import { findRootCause, isSecondaryError } from "../internal/root-cause";
import type { QueryChunk, QueryResponse, RetryValue, Session } from "../types";
import type { BoundQuery } from "../utils";
import { DoneFrame, ErrorFrame, type Frame, ValueFrame } from "../utils/frame";

interface QueryOptions extends AbortOptions {
    query: BoundQuery;
    transaction: Uuid | undefined;
    session: Session;
    json: boolean;
    retry?: RetryValue;
    /**
     * The query dialect to execute the query as. Defaults to `"sql"` (SurrealQL);
     * `"gql"` routes the query through the ISO GQL (ISO/IEC 39075) endpoint.
     */
    dialect?: "sql" | "gql";
}

type Collect<T extends unknown[], J extends boolean> = T extends []
    ? unknown[]
    : { [K in keyof T]: MaybeJsonify<T[K], J> };

type Responses<T extends unknown[], J extends boolean> = T extends []
    ? QueryResponse[]
    : { [K in keyof T]: QueryResponse<MaybeJsonify<T[K], J>> };

/**
 * A configurable query sent to a SurrealDB instance.
 */
export class Query<
    R extends unknown[] = unknown[],
    J extends boolean = false,
> extends DispatchedPromise<Collect<R, J>> {
    #connection: ConnectionController;
    #options: QueryOptions;

    constructor(connection: ConnectionController, options: QueryOptions) {
        super();
        this.#connection = connection;
        this.#options = options;
    }

    /**
     * Retrieve the inner query that will be sent to the database.
     */
    get inner(): BoundQuery {
        return this.#options.query;
    }

    /**
     * Configure the query to return the result of each response as a
     * JSON-compatible structure.
     *
     * This is useful when query results need to be serialized. Keep in mind
     * that your responses will lose SurrealDB type information.
     */
    json(): Query<R, true> {
        return new Query(this.#connection, { ...this.#options, json: true });
    }

    /**
     * Configure the query to automatically retry when it fails due to a transaction conflict.
     *
     * Under concurrent load a query may fail because another transaction wrote to the same data.
     * When retry is enabled, the entire query is re-sent with exponential backoff until it
     * succeeds or the configured attempts are exhausted.
     *
     * Retry only applies to `.collect()` (and awaiting the query directly), as the whole query is
     * re-sent on conflict. It does not apply to `.responses()` (which exposes partial results) or
     * `.stream()` (which yields results incrementally and cannot be safely replayed mid-stream).
     *
     * A transaction written into the query is retried as well. When one fails, the server reports
     * an error for each of its statements, and the conflict may be on its `COMMIT`: the error
     * which is checked for a conflict is the one which made the transaction fail, as it is for
     * `.collect()`, not one of the "not executed" errors reported for the other statements.
     *
     * **NOTE:** Retrying re-sends the full query. Only use this for queries that are safe to replay,
     * such as a single statement or a query wrapped in an explicit `BEGIN`/`COMMIT` block.
     * Re-sending a non-atomic, multi-statement query may apply some statements more than once.
     *
     * @example
     * ```ts
     * const [person] = await this.query("BEGIN; UPDATE counter SET n += 1; COMMIT").retry();
     * ```
     *
     * @param options Retry behavior. Defaults to enabling retry using the connection defaults.
     * @returns A new `Query` configured to retry on conflict.
     */
    retry(options: RetryValue = true): Query<R, J> {
        return new Query(this.#connection, {
            ...this.#options,
            retry: options,
        });
    }

    /**
     * Configure the query to be abandoned when a signal aborts.
     *
     * If the signal has already aborted, the query is not sent and fails straight away. If it aborts
     * later, the query stops waiting for the server and fails with the `reason` of the signal, so an
     * `AbortError` or a `TimeoutError` from `AbortSignal.timeout()` reaches the caller as it is. This
     * holds for `collect()`, for `responses()` and, by ending the iteration with the reason, for
     * `stream()`, which also lets go of what the stream holds. A query waiting to be retried is not
     * retried again.
     *
     * Aborting does not undo anything: it means "stop waiting", and nothing more. Over WebSocket the
     * server has no way of being told, so it may keep executing the query and discard the answer.
     * **A write which was sent before the signal aborted may or may not have been applied**, and a
     * caller which needs to know has to check. Over HTTP the request is cancelled, but a server may
     * well complete work it has begun.
     *
     * Calling this more than once, or in addition to a signal inherited from `withSignal()`,
     * combines the signals: the query is abandoned when any of them aborts.
     *
     * @example
     * ```ts
     * const people = await db
     *     .query("SELECT * FROM person")
     *     .signal(request.signal)
     *     .collect<[Person[]]>();
     *
     * // Give up after two seconds
     * await db.query("SELECT * FROM report").signal(AbortSignal.timeout(2000));
     * ```
     *
     * @param signal The signal which abandons the query. Without one, nothing changes.
     * @returns A new `Query` configured to be abandoned by the signal.
     */
    signal(signal: AbortSignal | undefined): Query<R, J> {
        return new Query(this.#connection, {
            ...this.#options,
            signals: addSignal(this.#options.signals, signal),
        });
    }

    /**
     * Configure how long to wait for the server to answer the query, in milliseconds, before giving up
     * on it with a `TimeoutError`. This overrides the `requestTimeout` of the connection for this query,
     * and is the way to allow a query longer than that default, or `0` to wait without limit.
     *
     * This is a limit on the client. It is not the `TIMEOUT` clause, which the server enforces and
     * the query builders expose as `.timeout()`. The server is not told that the client has given up,
     * and may well carry on: a write which timed out may or may not have been applied. Retries each
     * get the full time, as it applies to every request.
     *
     * To combine it with other reasons for abandoning a query, use `.signal()`: a timeout is no
     * different from `.signal(AbortSignal.timeout(milliseconds))`, apart from replacing the default.
     *
     * @example
     * ```ts
     * // Give the slow report a minute, whatever the connection default is
     * await db.query("SELECT * FROM report").requestTimeout(60_000);
     * ```
     *
     * @param milliseconds The time to wait for an answer, or `0` for no limit.
     * @returns A new `Query` configured with the request timeout.
     */
    requestTimeout(milliseconds: number): Query<R, J> {
        assertTimeout(milliseconds, "requestTimeout");

        return new Query(this.#connection, {
            ...this.#options,
            requestTimeout: milliseconds,
        });
    }

    /**
     * Collect and return the results of all queries at once. If any of the queries fail, the promise
     * will reject with the error of the first one which failed.
     *
     * When the query holds a transaction, that is the error which made the transaction fail, wherever
     * it comes. The server also reports the transaction's other statements as errors ("not executed",
     * "cancelled"), and those are only thrown when there is nothing else to throw. `.responses()` and
     * `.stream()` do not choose: they report the error of every statement as the server sent it.
     *
     * You can optionally pass a list of query indexes to collect only the results of specific queries.
     *
     * This is the same as awaiting the query directly, but allows specifying which queries to collect.
     *
     * @example
     * ```ts
     * const [people] = await this.query("SELECT * FROM person").collect<[Person[]]>();
     * ```
     *
     * @param queries The queries to collect. If no queries are provided, all queries will be collected.
     * @returns A promise that resolves to the results of all queries at once.
     */
    async collect<T extends unknown[] = R>(...queries: number[]): Promise<Collect<T, J>> {
        return this.#abortable((signal) => this.#collect<T>(signal, queries));
    }

    async #collect<T extends unknown[]>(
        signal: AbortSignal | undefined,
        queries: number[],
    ): Promise<Collect<T, J>> {
        throwIfAborted(signal);
        await raceAbort(this.#connection.ready(), signal);

        const options = RetryContext.mergeOptions(this.#options.retry, this.#connection.retry);
        const context = new RetryContext(options, signal);

        return context.run(async () => {
            const { json } = this.#options;
            const chunks = this.#open(signal);
            const responses: unknown[] = [];
            const failures: ServerError[] = [];
            const queryIndexes =
                queries.length > 0 ? new Map(queries.map((idx, i) => [idx, i])) : undefined;

            for await (const chunk of chunks) {
                if (chunk.error) {
                    // A failed transaction reports its other statements as errors too, and the
                    // failure itself can come after them: read on until it does.
                    failures.push(chunk.error);
                    if (isSecondaryError(chunk.error)) continue;
                    break;
                }

                if (queryIndexes?.has(chunk.query) === false) {
                    continue;
                }

                const index = queryIndexes?.get(chunk.query) ?? chunk.query;

                if (chunk.kind === "single") {
                    responses[index] = maybeJsonify(chunk.result?.[0], json);
                    continue;
                }

                const additions = maybeJsonify(chunk.result ?? [], json);
                let records = responses[index] as unknown[];

                if (!records) {
                    // Copied rather than adopted: a statement streamed in batches would otherwise
                    // have the rows of every later batch pushed into the first chunk's own array,
                    // which its emitter still holds.
                    records = [...additions];
                    responses[index] = records;
                } else {
                    // Appended one at a time rather than spread: a streamed
                    // batch is unbounded, and spreading it would pass every row
                    // as an argument and overflow the stack.
                    for (const addition of additions) records.push(addition);
                }
            }

            if (failures.length > 0) {
                throw findRootCause(failures);
            }

            return responses as Collect<T, J>;
        });
    }

    /**
     * Stream the response frames of the query as they are received as an AsyncIterable.
     *
     * Each iteration yields a **value**, **error**, or **done** frame. The provided
     * `isValue`, `isError`, and `isDone` methods can be used to check the type of frame, and
     * `isValueOf`, `isErrorOf`, and `isDoneOf` to check the type and that the frame belongs to
     * a specific statement, by its index.
     *
     * Values are provisional until the **done** frame for their statement arrives: an **error**
     * frame for a statement retracts every value already yielded for it, and the stream itself
     * throws when the query as a whole could not be completed. Statements are therefore counted
     * by their **done** frames.
     *
     * Abandoning the stream, such as by breaking out of the loop, stops the query on servers
     * which support it, so results which are no longer wanted are no longer produced.
     *
     * @example
     * ```ts
     * const stream = this.query("SELECT * FROM person").stream();
     *
     * for await (const frame of stream) {
     *     if (frame.isValue<Person>(0)) {
     *         // use frame.value
     *     }
     * }
     * ```
     *
     * @returns An async iterable of query frames.
     */
    async *stream<T = unknown>(): AsyncIterable<Frame<T, J>> {
        const scope = abortScope(this.#options.signals ?? []);

        try {
            yield* this.#frames<T>(scope.signal);
        } finally {
            scope.dispose();
        }
    }

    async *#frames<T>(signal: AbortSignal | undefined): AsyncIterable<Frame<T, J>> {
        throwIfAborted(signal);
        await raceAbort(this.#connection.ready(), signal);

        const { json } = this.#options;
        const chunks = this.#open<T>(signal);

        for await (const chunk of chunks) {
            if (chunk.error) {
                yield new ErrorFrame<T, J>(chunk.query, chunk.stats, chunk.error);
                continue;
            }

            if (chunk.kind === "single") {
                yield new ValueFrame<T, J>(
                    chunk.query,
                    maybeJsonify(chunk.result?.[0] as T, json as J),
                    true,
                );
                yield new DoneFrame<T, J>(chunk.query, chunk.stats, chunk.type ?? "other");
                continue;
            }

            const values = chunk.result as unknown[];

            for (const value of values) {
                yield new ValueFrame<T, J>(chunk.query, maybeJsonify(value as T, json as J), false);
            }

            if (chunk.kind === "batched-final") {
                yield new DoneFrame<T, J>(chunk.query, chunk.stats, chunk.type ?? "other");
            }
        }
    }

    /**
     * Collect and return the responses of all queries at once. Failed queries will be returned
     * with `success: false` and the associated error, while successful queries will have
     * `success: true` and their result.
     *
     * You can optionally pass a list of query indexes to collect only the results of specific responses.
     *
     * @example
     * ```ts
     * const [people] = await this.query("SELECT * FROM person").responses<[Person[]]>();
     *
     * people.success; // true
     * people.result; // Person[]
     * ```
     *
     * @param queries The queries to collect. If no queries are provided, all queries will be collected.
     * @returns A promise that resolves to the responses of all queries at once.
     */
    async responses<T extends unknown[] = R>(...queries: number[]): Promise<Responses<T, J>> {
        return this.#abortable((signal) => this.#responses<T>(signal, queries));
    }

    async #responses<T extends unknown[]>(
        signal: AbortSignal | undefined,
        queries: number[],
    ): Promise<Responses<T, J>> {
        throwIfAborted(signal);
        await raceAbort(this.#connection.ready(), signal);

        const { json } = this.#options;
        const chunks = this.#open(signal);
        const collections: unknown[] = [];
        const responses: QueryResponse[] = [];
        const queryIndexes =
            queries.length > 0 ? new Map(queries.map((idx, i) => [idx, i])) : undefined;

        for await (const chunk of chunks) {
            if (queryIndexes?.has(chunk.query) === false) {
                if (chunk.error) {
                    throw chunk.error;
                }

                continue;
            }

            const index = queryIndexes?.get(chunk.query) ?? chunk.query;

            if (chunk.error) {
                responses[index] = {
                    success: false,
                    error: chunk.error,
                    stats: chunk.stats,
                };
                continue;
            }

            if (chunk.kind === "single") {
                responses[index] = {
                    success: true,
                    result: maybeJsonify(chunk.result?.[0], json),
                    stats: chunk.stats,
                    type: chunk.type ?? "other",
                };
                continue;
            }

            const additions = maybeJsonify(chunk.result ?? [], json);
            let records = collections[index] as unknown[];

            if (!records) {
                // Copied rather than adopted, for the reason given in `collect`.
                records = [...additions];
                collections[index] = records;
            } else {
                // Appended one at a time rather than spread: a streamed batch
                // is unbounded, and spreading it would pass every row as an
                // argument and overflow the stack.
                for (const addition of additions) records.push(addition);
            }

            if (chunk.kind === "batched-final") {
                responses[index] = {
                    success: true,
                    result: records,
                    stats: chunk.stats,
                    type: chunk.type ?? "other",
                };
            }
        }

        return responses as Responses<T, J>;
    }

    async dispatch(): Promise<Collect<R, J>> {
        return this.collect();
    }

    /**
     * Run work which is bound to the signals of this query, letting go of them once it is done.
     */
    async #abortable<V>(run: (signal: AbortSignal | undefined) => Promise<V>): Promise<V> {
        const scope = abortScope(this.#options.signals ?? []);

        try {
            return await run(scope.signal);
        } finally {
            scope.dispose();
        }
    }

    /**
     * Send the query as one request, and return the chunks of its answer.
     *
     * This is the one place where the chunks of the engine are read through a signal. The request
     * is bound to the signal of the caller and to the request timeout, if there is one, which is
     * handed to the engine so it can stop the request itself. The chunks are read through
     * `abortableIterable`, which does not rely on the engine having done so: when the signal aborts
     * a read in progress fails with its reason at once, and the engine's iterator is returned, which
     * is what an engine which can stop a stream on the server acts on.
     *
     * The request timeout is measured from here, once per request, so a retry starts it afresh.
     */
    #open<T = unknown>(signal: AbortSignal | undefined): AsyncIterable<QueryChunk<T>> {
        const { query, transaction, session, dialect } = this.#options;
        const timeout = this.#options.requestTimeout ?? this.#connection.requestTimeout;
        const request = abortScope(signal ? [signal] : [], timeout);

        try {
            throwIfAborted(request.signal);

            const options = request.signal && { signal: request.signal };

            // Routed to the transport which matches the configured dialect
            return abortableIterable(
                dialect === "gql"
                    ? this.#connection.gql<T>(query, session, transaction, options)
                    : this.#connection.query<T>(query, session, transaction, options),
                request.signal,
                request.dispose,
            );
        } catch (error) {
            request.dispose();
            throw error;
        }
    }
}
