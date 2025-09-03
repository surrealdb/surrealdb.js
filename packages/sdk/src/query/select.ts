import type { ConnectionController } from "../controller";
import { DispatchedPromise } from "../internal/dispatched-promise";
import { only } from "../internal/internal-expressions";
import type { MaybeJsonify } from "../internal/maybe-jsonify";
import { type BoundQuery, surql } from "../utils";
import type { Frame } from "../utils/frame";
import type { RecordId, RecordIdRange, Table, Uuid } from "../value";
import { Query } from "./query";

interface SelectOptions {
    what: RecordId | RecordIdRange | Table;
    transaction: Uuid | undefined;
    json: boolean;
}

/**
 * A configurable `Promise` for a select query sent to a SurrealDB instance.
 */
export class SelectPromise<T, J extends boolean = false> extends DispatchedPromise<
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
    json(): SelectPromise<T, true> {
        return new SelectPromise(this.#connection, {
            ...this.#options,
            json: true,
        });
    }

    /**
     * Compile this qurery into a BoundQuery
     */
    compile(): BoundQuery {
        return this.#build().inner;
    }

    /**
     * Stream the results of the query as they are received.
     *
     * @returns An async iterable of query frames.
     */
    async *stream(): AsyncIterable<Frame<T, J>> {
        await this.#connection.ready();
        const query = this.#build().stream<T>();

        for await (const frame of query) {
            yield frame;
        }
    }

    protected async dispatch(): Promise<MaybeJsonify<T, J>> {
        await this.#connection.ready();
        const [result] = await this.#build().collect();
        return result as MaybeJsonify<T, J>;
    }

    #build(): Query<J> {
        const { what, transaction, json } = this.#options;

        const query = surql`SELECT * FROM ${only(what)}`;

        return new Query(this.#connection, {
            query,
            transaction,
            json,
        });
    }
}
