import type { ConnectionController } from "../controller";
import { ResponseError } from "../errors";
import { DispatchedPromise } from "../internal/dispatched-promise";
import { jsonifyStream } from "../internal/jsonify-stream";
import type { QueryChunk, QueryResponse } from "../types";
import type { MaybeJsonify } from "../types/internal";
import { collectChunks } from "../utils/collect-chunks";
import type { Uuid } from "../value";

type OutputMode = "results" | "responses" | "chunks";

type Output<T extends unknown[], O extends OutputMode, J extends boolean> = O extends "results"
    ? { [K in keyof T]: MaybeJsonify<T[K], J> }
    : O extends "responses"
      ? { [K in keyof T]: QueryResponse<MaybeJsonify<T[K], J>> }
      : AsyncIterable<QueryChunk<{ [K in keyof T]: MaybeJsonify<T[K], J> }[number]>>;

/**
 * A configurable `Promise` for a query sent to a SurrealDB instance.
 */
export class QueryPromise<
    T extends unknown[],
    O extends OutputMode = "results",
    J extends boolean = false,
> extends DispatchedPromise<Output<T, O, J>> {
    #connection: ConnectionController;
    #query: string;
    #bindings: Record<string, unknown> | undefined;
    #transaction: Uuid | undefined;
    #json: J;
    #mode: O;

    constructor(
        connection: ConnectionController,
        query: string,
        bindings: Record<string, unknown> | undefined,
        transaction: Uuid | undefined,
        json: J,
        mode: O,
    ) {
        super();
        this.#connection = connection;
        this.#query = query;
        this.#bindings = bindings;
        this.#transaction = transaction;
        this.#mode = mode;
        this.#json = json;
    }

    /**
     * Configure the query to return the result of each response.
     *
     * If any of the responses failed, the query function will throw an
     * error.
     *
     * **This is the default behavior for queries**
     */
    results(): QueryPromise<T, "results", J> {
        return new QueryPromise(
            this.#connection,
            this.#query,
            this.#bindings,
            this.#transaction,
            this.#json,
            "results",
        );
    }

    /**
     * Configure the query to return the full response object for each result,
     * including stats, result, and error.
     *
     * This will prevent the query function from throwing an error if any
     * of the responses contain an error, instead leaving it to you to handle
     * the error.
     */
    responses(): QueryPromise<T, "responses", J> {
        return new QueryPromise(
            this.#connection,
            this.#query,
            this.#bindings,
            this.#transaction,
            this.#json,
            "responses",
        );
    }

    /**
     * Configure the query to return a stream of response chunks.
     *
     * This will prevent the query function from throwing an error if any
     * of the responses contain an error, instead leaving it to you to handle
     * the error.
     */
    stream(): QueryPromise<T, "chunks", J> {
        return new QueryPromise(
            this.#connection,
            this.#query,
            this.#bindings,
            this.#transaction,
            this.#json,
            "chunks",
        );
    }

    /**
     * Configure the query to return the result of each response as a
     * JSON-compatible structure.
     *
     * This is useful when query results need to be serialized. Keep in mind
     * that your responses will lose SurrealDB type information.
     */
    json(): QueryPromise<T, O, true> {
        return new QueryPromise(
            this.#connection,
            this.#query,
            this.#bindings,
            this.#transaction,
            true,
            this.#mode,
        );
    }

    /**
     * Attach this query to a specific transaction.
     *
     * @param transactionId The ID of the transaction to attach this query to
     */
    txn(transactionId: Uuid): QueryPromise<T, O, J> {
        return new QueryPromise(
            this.#connection,
            this.#query,
            this.#bindings,
            transactionId,
            this.#json,
            this.#mode,
        );
    }

    protected async dispatch(): Promise<Output<T, O, J>> {
        await this.#connection.ready();

        let chunks = this.#connection.query(this.#query, this.#bindings, this.#transaction);

        if (this.#json) {
            chunks = jsonifyStream(chunks);
        }

        if (this.#mode === "chunks") {
            return chunks as Output<T, O, J>;
        }

        const responses = await collectChunks(chunks);

        if (this.#mode === "responses") {
            return responses as Output<T, O, J>;
        }

        return responses.map((response) => {
            if (!response.success) {
                throw new ResponseError(response);
            }

            return response.result;
        }) as Output<T, O, J>;
    }
}
