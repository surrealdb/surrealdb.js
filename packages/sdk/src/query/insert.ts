import type { ConnectionController } from "../controller";
import { DispatchedPromise } from "../internal/dispatched-promise";
import type { Frame } from "../internal/frame";
import type { MaybeJsonify } from "../internal/maybe-jsonify";
import type { Doc } from "../types";
import { surql } from "../utils";
import type { Table, Uuid } from "../value";
import { Query } from "./query";

interface InsertOptions {
    table: Table | undefined;
    what: Doc | Doc[];
    transaction: Uuid | undefined;
    json: boolean;
}

/**
 * A configurable `Promise` for an insert query sent to a SurrealDB instance.
 */
export class InsertPromise<T, U extends Doc, J extends boolean = false> extends DispatchedPromise<
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
    json(): InsertPromise<T, U, true> {
        return new InsertPromise<T, U, true>(this.#connection, {
            ...this.#options,
            json: true,
        });
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
        const { table, what, transaction, json } = this.#options;

        const builder = surql`INSERT`;

        if (table) {
            builder.append(surql` INTO ${table}`);
        }

        builder.append(surql` ${what}`);

        return new Query(this.#connection, {
            query: builder.query,
            bindings: builder.bindings,
            transaction,
            json,
        });
    }
}
