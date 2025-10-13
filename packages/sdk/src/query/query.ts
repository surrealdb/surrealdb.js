import type { ConnectionController } from "../controller";
import { ResponseError } from "../errors";
import { DispatchedPromise } from "../internal/dispatched-promise";
import { type MaybeJsonify, maybeJsonify } from "../internal/maybe-jsonify";
import type { BoundQuery } from "../utils";
import { DoneFrame, ErrorFrame, type Frame, ValueFrame } from "../utils/frame";
import type { Uuid } from "../value";

interface QueryOptions {
    query: BoundQuery;
    transaction: Uuid | undefined;
    json: boolean;
}

type Collect<T extends unknown[], J extends boolean> = T extends []
    ? unknown[]
    : { [K in keyof T]: MaybeJsonify<T[K], J> };

/**
 * A configurable query sent to a SurrealDB instance.
 */
export class Query<
    R extends unknown[] = unknown[],
    J extends boolean = false,
> extends DispatchedPromise<void> {
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
        return new Query(this.#connection, {
            ...this.#options,
            json: true,
        });
    }

    /**
     * Collect and return the results of all queries at once. If any of the queries fail, the promise
     * will reject.
     *
     * You can optionally pass a list of query indexes to collect only the results of specific queries.
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
        await this.#connection.ready();

        const { query, transaction, json } = this.#options;
        const chunks = this.#connection.query(query, transaction);
        const responses: unknown[] = [];
        const queryIndexes =
            queries.length > 0 ? new Map(queries.map((idx, i) => [idx, i])) : undefined;

        for await (const chunk of chunks) {
            if (chunk.error) {
                throw new ResponseError(chunk.error);
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
                records = additions;
                responses[index] = records;
            } else {
                records.push(...additions);
            }
        }

        return responses as Collect<T, J>;
    }

    /**
     * Stream the response frames of the query as they are received as an AsyncIterable.
     *
     * Each iteration yields a **value**, **error**, or **done** frame. The provided
     * `isValue`, `isError`, and `isDone` methods can be used to check the type of frame.
     * You can pass a query index to these functions to check if the frame is associated with a
     * specific query.
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
        await this.#connection.ready();

        const { query, transaction, json } = this.#options;
        const chunks = this.#connection.query(query, transaction);

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
                yield new DoneFrame<T, J>(chunk.query, chunk.stats);
                continue;
            }

            const values = chunk.result as unknown[];

            for (const value of values) {
                yield new ValueFrame<T, J>(chunk.query, maybeJsonify(value as T, json as J), false);
            }

            if (chunk.kind === "batched-final") {
                yield new DoneFrame<T, J>(chunk.query, chunk.stats);
            }
        }
    }

    async dispatch(): Promise<void> {
        await this.#connection.ready();

        const { query, transaction } = this.#options;
        const chunks = this.#connection.query(query, transaction);

        for await (const chunk of chunks) {
            if (chunk.error) {
                throw new ResponseError(chunk.error);
            }
        }
    }
}
