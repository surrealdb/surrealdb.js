import type { ConnectionController } from "../controller";
import { DispatchedPromise } from "../internal/dispatched-promise";
import type { Frame } from "../internal/frame";
import type { MaybeJsonify } from "../internal/maybe-jsonify";
import type { Doc } from "../types";
import { surql } from "../utils";
import { RecordId, type Table, type Uuid } from "../value";
import { Query } from "./query";

interface CreateOptions {
    what: RecordId | Table;
    data?: Doc;
    transaction: Uuid | undefined;
    json: boolean;
}

/**
 * A configurable `Promise` for a create query sent to a SurrealDB instance.
 */
export class CreatePromise<T, U extends Doc, J extends boolean = false> extends DispatchedPromise<
    MaybeJsonify<T, J>
> {
    #connection: ConnectionController;
    #options: CreateOptions;

    constructor(connection: ConnectionController, options: CreateOptions) {
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
    json(): CreatePromise<T, U, true> {
        return new CreatePromise<T, U, true>(this.#connection, {
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
        const { what, data, transaction, json } = this.#options;

        const builder =
            what instanceof RecordId ? surql`CREATE ONLY ${what}` : surql`CREATE ${what}`;

        if (data) {
            builder.append(surql` CONTENT ${data}`);
        }

        return new Query(this.#connection, {
            query: builder.query,
            bindings: builder.bindings,
            transaction,
            json,
        });
    }
}
