import type { ConnectionController } from "../controller";
import { DispatchedPromise } from "../internal/dispatched-promise";
import type { MaybeJsonify } from "../internal/maybe-jsonify";
import { surql } from "../utils";
import type { Frame } from "../utils/frame";
import { RecordId, type RecordIdRange, type Table, type Uuid } from "../value";
import { Query } from "./query";

interface DeleteOptions {
    what: RecordId | RecordIdRange | Table;
    transaction: Uuid | undefined;
    json: boolean;
}

/**
 * A configurable `Promise` for a delete query sent to a SurrealDB instance.
 */
export class DeletePromise<T, J extends boolean = false> extends DispatchedPromise<
    MaybeJsonify<T, J>
> {
    #connection: ConnectionController;
    #options: DeleteOptions;

    constructor(connection: ConnectionController, options: DeleteOptions) {
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
    json(): DeletePromise<T, true> {
        return new DeletePromise<T, true>(this.#connection, {
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
        const { what, transaction, json } = this.#options;

        const builder =
            what instanceof RecordId ? surql`DELETE ONLY ${what}` : surql`DELETE ${what}`;

        return new Query(this.#connection, {
            query: builder.query,
            bindings: builder.bindings,
            transaction,
            json,
        });
    }
}
