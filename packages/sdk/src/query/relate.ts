import type { ConnectionController } from "../controller";
import { DispatchedPromise } from "../internal/dispatched-promise";
import type { MaybeJsonify } from "../internal/maybe-jsonify";
import type { AnyRecordId, Doc } from "../types";
import { type BoundQuery, surql } from "../utils";
import type { Frame } from "../utils/frame";
import { RecordId, type Table, type Uuid } from "../value";
import { Query } from "./query";

interface RelateOptions {
    from: AnyRecordId | AnyRecordId[];
    what: Table | RecordId;
    to: AnyRecordId | AnyRecordId[];
    data?: Doc;
    transaction: Uuid | undefined;
    json: boolean;
}

/**
 * A configurable `Promise` for a relate query sent to a SurrealDB instance.
 */
export class RelatePromise<T, U extends Doc, J extends boolean = false> extends DispatchedPromise<
    MaybeJsonify<T, J>
> {
    #connection: ConnectionController;
    #options: RelateOptions;

    constructor(connection: ConnectionController, options: RelateOptions) {
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
    json(): RelatePromise<T, U, true> {
        return new RelatePromise<T, U, true>(this.#connection, {
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
        const { from, what, to, data, transaction, json } = this.#options;

        const isMultiple = Array.isArray(from) || Array.isArray(to);

        if (isMultiple && what instanceof RecordId) {
            throw new Error("Edge must be a table when creating multiple edges");
        }

        const query = surql`RELATE `;

        if (!isMultiple) {
            query.append(surql` ONLY`);
        }

        query.append(surql` ${from}->${what}->${to}`);

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
