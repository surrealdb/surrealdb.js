import type { ConnectionController } from "../controller";
import { ResponseError } from "../errors";
import type { Frame, MaybeJsonify } from "../types/internal";
import type { Uuid } from "../value";

interface QueryOptions {
    query: string;
    bindings: Record<string, unknown> | undefined;
    transaction: Uuid | undefined;
    json: boolean;
}

type UnknownFrame<J extends boolean> = { query: number } & Frame<unknown, J>;
type MappedFrame<T extends readonly unknown[], J extends boolean> = {
    [K in keyof T & `${number}`]: {
        query: K extends `${infer N extends number}` ? N : number;
    } & Frame<T[K], J>;
}[keyof T & `${number}`];

type QueryFrame<T extends readonly unknown[], J extends boolean> = T extends []
    ? UnknownFrame<J>
    : MappedFrame<T, J>;

type Collect<T extends unknown[], J extends boolean> = T extends []
    ? unknown[]
    : { [K in keyof T]: MaybeJsonify<T[K], J> };

/**
 * A configurable query sent to a SurrealDB instance.
 */
export class Query<J extends boolean = false> {
    #connection: ConnectionController;
    #options: QueryOptions;

    constructor(connection: ConnectionController, options: QueryOptions) {
        this.#connection = connection;
        this.#options = options;
    }

    /**
     * Configure the query to return the result of each response as a
     * JSON-compatible structure.
     *
     * This is useful when query results need to be serialized. Keep in mind
     * that your responses will lose SurrealDB type information.
     */
    json(): Query<true> {
        return new Query(this.#connection, {
            ...this.#options,
            json: true,
        });
    }

    /**
     * Collect and return the results of all responses at once.
     *
     * If any statement in the query fails, the promise will reject.
     *
     * @param queries The queries to collect. If no queries are provided, all queries will be collected.
     * @returns A promise that resolves to the results of all responses at once.
     */
    async collect<T extends unknown[] = []>(...queries: number[]): Promise<Collect<T, J>> {
        await this.#connection.ready();

        const { query, bindings, transaction } = this.#options;
        const chunks = this.#connection.query(query, bindings, transaction);
        const responses: unknown[] = [];
        const accept = queries.length > 0 ? new Set(queries) : undefined;

        for await (const chunk of chunks) {
            if (chunk.error) {
                throw new ResponseError(chunk.error);
            }

            if (accept?.has(chunk.query) === false) {
                continue;
            }

            if (chunk.kind === "single") {
                responses[chunk.query] = chunk.result?.[0] as T;
                continue;
            }

            let records = responses[chunk.query] as unknown[];

            if (!records) {
                records = chunk.result ?? [];
                responses[chunk.query] = records;
            } else {
                records.push(...(chunk.result ?? []));
            }
        }

        return responses as Collect<T, J>;
    }

    /**
     * Stream the results of the query as they are received.
     *
     * Each frame contains a `query` index corresponding to the query that produced the frame.
     *
     * @param queries The queries to stream. If no queries are provided, all queries will be streamed.
     * @returns An async iterable of query frames.
     */
    async *stream<T extends unknown[] = []>(...queries: number[]): AsyncIterable<QueryFrame<T, J>> {
        await this.#connection.ready();

        const { query, bindings, transaction } = this.#options;
        const chunks = this.#connection.query(query, bindings, transaction);
        const accept = queries.length > 0 ? new Set(queries) : undefined;

        for await (const chunk of chunks) {
            if (accept?.has(chunk.query) === false) {
                if (chunk.error) throw new ResponseError(chunk.error);
                continue;
            }

            if (chunk.error) {
                yield {
                    query: chunk.query,
                    type: "error",
                    stats: chunk.stats,
                    error: {
                        code: chunk.error.code,
                        message: chunk.error.message,
                    },
                } as QueryFrame<T, J>;
                continue;
            }

            if (chunk.kind === "single") {
                yield {
                    query: chunk.query,
                    type: "value",
                    value: chunk.result?.[0] as T,
                } as QueryFrame<T, J>;
                continue;
            }

            const values = chunk.result as unknown[];

            for (const value of values) {
                yield {
                    query: chunk.query,
                    type: "value",
                    value: value as T,
                } as QueryFrame<T, J>;
            }

            if (chunk.kind === "batched-final") {
                yield {
                    query: chunk.query,
                    type: "done",
                    stats: chunk.stats,
                } as QueryFrame<T, J>;
            }
        }
    }
}
