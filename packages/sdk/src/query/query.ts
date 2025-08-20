import type { ConnectionController } from "../controller";
import { QueryError, ResponseError } from "../errors";
import { DispatchedPromise } from "../internal/dispatched-promise";
import { jsonifyStream } from "../internal/jsonify-stream";
import type { QueryResponse } from "../types";
import type { MaybeJsonify } from "../types/internal";
import { collectResponses } from "../utils/collect-chunks";
import type { Uuid } from "../value";

type QueryOutput = "result" | "response" | "stream";

interface QueryOptions {
    query: string;
    bindings: Record<string, unknown> | undefined;
    transaction: Uuid | undefined;
    json: boolean;
    index: number;
    outputs: QueryOutput[];
    accepted: Set<number>;
}

type Result<T> = { _result: T };
type Response<T> = { _response: T };
type Stream<T> = { _stream: T };

type Outputs<T extends unknown[] = [], J extends boolean = false> = {
    [K in keyof T]: T[K] extends Result<infer U>
        ? Promise<MaybeJsonify<U, J>>
        : T[K] extends Response<infer U>
          ? Promise<QueryResponse<MaybeJsonify<U, J>>>
          : T[K] extends Stream<infer U>
            ? AsyncIterable<MaybeJsonify<U, J>>
            : never;
};

/**
 * A configurable `Promise` for a query sent to a SurrealDB instance.
 */
export class QueryPromise<
    R extends unknown[] = [],
    J extends boolean = false,
> extends DispatchedPromise<Outputs<R, J>> {
    #connection: ConnectionController;
    #options: QueryOptions;

    constructor(connection: ConnectionController, options: QueryOptions) {
        super();
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
    json(): QueryPromise<R, true> {
        return new QueryPromise(this.#connection, {
            ...this.#options,
            json: true,
        });
    }

    /**
     * Collect and return the results of all responses at once.
     *
     * If any statement in the query fails, the promise will reject.
     *
     * @returns A promise that resolves to the results of all responses at once.
     */
    collect<T extends unknown[]>(): QueryCollectorPromise<T, J> {
        return new QueryCollectorPromise(this.#connection, this.#options);
    }

    // Accept a response
    #accept<T>(index: number, output: QueryOutput): QueryPromise<[...R, T], J> {
        if (this.#options.accepted.has(index)) {
            throw new QueryError(`Statement index ${index} has already been accepted.`);
        }

        return new QueryPromise(this.#connection, {
            ...this.#options,
            index: index + 1,
            outputs: [...this.#options.outputs, output],
            accepted: new Set(this.#options.accepted).add(index),
        });
    }

    /**
     * Accept the result of the specified statement index as the next result in the output tuple.
     *
     * This is useful when you want to access the result of a specific statement in the query.
     *
     * @param index The index of the statement to return the result of.
     * @example
     * ```ts
     * const [person] = await db.query("LET $id = person:foo; SELECT * FROM $id").result(1);
     * const record = await person;
     * ```
     */
    result<T = unknown>(index: number): QueryPromise<[...R, Result<T>], J> {
        return this.#accept(index, "result");
    }

    /**
     * Accept the response of the specified statement index as the next result in the output tuple.
     *
     * This is useful when you want to access the raw response, including statistics. You will need
     * to handle errors manually.
     *
     * @param index The index of the statement to return the response of.
     * @example
     * ```ts
     * const [person] = await db.query("LET $id = person:foo; SELECT * FROM $id").response(1);
     * const response = await person;
     *
     * if (response.success) {
     *     console.log(response.result);
     * } else {
     *     console.error(response.error);
     * }
     *```
     */
    response<T = unknown>(index: number): QueryPromise<[...R, Response<T>], J> {
        return this.#accept(index, "response");
    }

    /**
     * Accept the result of the specified statement index as the next result in the output tuple.
     *
     * This is useful when you want to access the result of a specific statement in the query.
     *
     * @example
     * ```ts
     * const [person] = await db.query("LET $id = person:foo; SELECT * FROM $id").result(1);
     * const record = await person;
     *
     * @param index The index of the statement to return the result of.
     */
    stream<T = unknown>(index: number): QueryPromise<[...R, Stream<T>], J> {
        return this.#accept(index, "stream");
    }

    protected async dispatch(): Promise<Outputs<R, J>> {}
}

type Collection<T extends unknown[], J extends boolean> = {
    [K in keyof T]: MaybeJsonify<T[K], J>;
};

/**
 * A `Promise` for collecting the results of a query.
 */
export class QueryCollectorPromise<
    T extends unknown[] = [],
    J extends boolean = false,
> extends DispatchedPromise<Collection<T, J>> {
    #connection: ConnectionController;
    #options: QueryOptions;

    constructor(connection: ConnectionController, options: QueryOptions) {
        super();
        this.#connection = connection;
        this.#options = options;
    }

    protected async dispatch(): Promise<Collection<T, J>> {
        await this.#connection.ready();

        const { query, bindings, transaction, json } = this.#options;

        let chunks = this.#connection.query(query, bindings, transaction);

        if (json) {
            chunks = jsonifyStream(chunks);
        }

        const responses = await collectResponses(chunks);

        return responses.map((response) => {
            if (!response.success) {
                throw new ResponseError(response);
            }

            return response.result;
        }) as Collection<T, J>;
    }
}
