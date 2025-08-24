import type { ConnectionController } from "../controller";
import { DispatchedPromise } from "../internal/dispatched-promise";
import type { Doc } from "../types";
import type { Frame, MaybeJsonify } from "../types/internal";
import { surql } from "../utils";
import { RecordId, type RecordIdRange, type Table, type Uuid } from "../value";
import { Query } from "./query";

interface UpdateOptions {
    thing: RecordId | RecordIdRange | Table;
    data?: Doc;
    transaction: Uuid | undefined;
    json: boolean;
}

/**
 * A configurable `Promise` for an update query sent to a SurrealDB instance.
 */
export class UpdatePromise<T, U extends Doc, J extends boolean = false> extends DispatchedPromise<
    MaybeJsonify<T, J>
> {
    #connection: ConnectionController;
    #options: UpdateOptions;

    constructor(connection: ConnectionController, options: UpdateOptions) {
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
    json(): UpdatePromise<T, U, true> {
        return new UpdatePromise<T, U, true>(this.#connection, {
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
        const query = this.#build().stream(0);

        for await (const frame of query) {
            yield frame as Frame<T, J>;
        }
    }

    protected async dispatch(): Promise<MaybeJsonify<T, J>> {
        await this.#connection.ready();
        const [result] = await this.#build().collect(0);
        return result as MaybeJsonify<T, J>;
    }

    #build(): Query<J> {
        const { thing, data, transaction, json } = this.#options;

        const builder =
            thing instanceof RecordId ? surql`UPDATE ONLY ${thing}` : surql`UPDATE ${thing}`;

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
