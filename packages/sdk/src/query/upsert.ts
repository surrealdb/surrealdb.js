import type { ConnectionController } from "../controller";
import { DispatchedPromise } from "../internal/dispatched-promise";
import type { MaybeJsonify } from "../internal/maybe-jsonify";
import type { Doc } from "../types";
import { surql } from "../utils";
import type { Frame } from "../utils/frame";
import { RecordId, type RecordIdRange, type Table, type Uuid } from "../value";
import { Query } from "./query";

interface UpsertOptions {
    thing: RecordId | RecordIdRange | Table;
    data?: Doc;
    transaction: Uuid | undefined;
    json: boolean;
}

/**
 * A configurable `Promise` for an upsert query sent to a SurrealDB instance.
 */
export class UpsertPromise<T, U extends Doc, J extends boolean = false> extends DispatchedPromise<
    MaybeJsonify<T, J>
> {
    #connection: ConnectionController;
    #options: UpsertOptions;

    constructor(connection: ConnectionController, options: UpsertOptions) {
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
    json(): UpsertPromise<T, U, true> {
        return new UpsertPromise<T, U, true>(this.#connection, {
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
        const { thing, data, transaction, json } = this.#options;

        const query =
            thing instanceof RecordId ? surql`UPSERT ONLY ${thing}` : surql`UPSERT ${thing}`;

        if (data) {
            query.append(surql` CONTENT ${data}`);
        }

        return new Query(this.#connection, {
            query,
            transaction,
            json,
        });
    }
}
