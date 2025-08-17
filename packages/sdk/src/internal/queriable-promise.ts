import type { ConnectionController } from "../controller";
import type { QueryChunk, QueryOutput } from "../types";
import { type BoundQuery, jsonify } from "../utils";
import { collectChunks } from "../utils/collect-chunks";
import type { Uuid } from "../value";
import { DispatchedPromise } from "./dispatched-promise";

/**
 * A `DispatchedPromise` that is bound to a specific connection and
 * allows the execution of queries against that remote database.
 */
export abstract class QueriablePromise<
    T,
    S extends boolean = false,
    J extends boolean = false,
> extends DispatchedPromise<QueryOutput<T, S, J>> {
    #stream = false;
    #json = false;
    #txn: Uuid | undefined;

    protected _connection: ConnectionController;

    protected abstract build(): BoundQuery;

    constructor(connection: ConnectionController) {
        super();
        this._connection = connection;
    }

    /**
     * Append this query to a specific transaction.
     *
     * **NOTE**: This functionality is not yet used by SurrealDB.
     *
     * @param txn The unique transaction identifier.
     * @returns self
     */
    txn(txn: Uuid): QueriablePromise<T, S, J> {
        this.#txn = txn;
        return this as QueriablePromise<T, S, J>;
    }

    /**
     * Returns an `AsyncIterable` stream of query chunks as they are received from the remote database.
     *
     * **NOTE**: Not all engines support streaming, and the results may be buffered in memory.
     *
     * @returns self
     */
    stream(): QueriablePromise<T, true, J> {
        this.#stream = true;
        return this as unknown as QueriablePromise<T, true, J>;
    }

    /**
     * Convert the response to a JSON compatible format, ensuring that
     * the response is serializable as a valid JSON structure.
     * @returns self
     */
    jsonify(): QueriablePromise<T, S, true> {
        this.#json = true;
        return this as unknown as QueriablePromise<T, S, true>;
    }

    protected override async dispatch(): Promise<QueryOutput<T, S, J>> {
        await this._connection.ready();
        const { query, bindings } = this.build();

        let response = this._connection.query(query, bindings, this.#txn);

        if (this.#json) {
            response = jsonifyStream(response);
        }

        if (this.#stream) {
            return response as QueryOutput<T, S, J>;
        }

        return (await collectChunks(response)) as QueryOutput<T, S, J>;
    }
}

// Jsonify the results within a response stream
async function* jsonifyStream(
    stream: AsyncIterable<QueryChunk<unknown>>,
): AsyncIterable<QueryChunk<unknown>> {
    for await (const chunk of stream) {
        if (chunk.response.success) {
            chunk.response.result = jsonify(chunk.response.result);
        }

        yield chunk;
    }
}
