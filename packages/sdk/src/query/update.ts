import type { ConnectionController } from "../controller";
import { DispatchedPromise } from "../internal/dispatched-promise";
import { internalQuery } from "../internal/internal-query";
import type { Doc } from "../types";
import type { MaybeJsonify } from "../types/internal";
import { surql } from "../utils";
import { RecordId, type RecordIdRange, type Table, type Uuid } from "../value";

/**
 * A configurable `Promise` for an update query sent to a SurrealDB instance.
 */
export class UpdatePromise<T, U extends Doc, J extends boolean = false> extends DispatchedPromise<
    MaybeJsonify<T, J>
> {
    #connection: ConnectionController;
    #thing: RecordId | RecordIdRange | Table;
    #data?: U;
    #transaction: Uuid | undefined;
    #json: J;

    constructor(
        connection: ConnectionController,
        thing: RecordId | RecordIdRange | Table,
        data?: U,
    ) {
        super();
        this.#connection = connection;
        this.#thing = thing;
        this.#data = data;
        this.#transaction = undefined;
        this.#json = false as J;
    }

    /**
     * Configure the query to return the result as a
     * JSON-compatible structure.
     *
     * This is useful when query results need to be serialized. Keep in mind
     * that your responses will lose SurrealDB type information.
     */
    json(): UpdatePromise<T, U, true> {
        const promise = new UpdatePromise<T, U, true>(this.#connection, this.#thing, this.#data);
        promise.#transaction = this.#transaction;
        return promise;
    }

    /**
     * Attach this query to a specific transaction.
     *
     * @param transactionId The ID of the transaction to attach this query to
     */
    txn(transactionId: Uuid): UpdatePromise<T, U, J> {
        const promise = new UpdatePromise<T, U, J>(this.#connection, this.#thing, this.#data);
        promise.#transaction = transactionId;
        promise.#json = this.#json;
        return promise;
    }

    protected async dispatch(): Promise<MaybeJsonify<T, J>> {
        await this.#connection.ready();

        const query =
            this.#thing instanceof RecordId
                ? surql`UPDATE ONLY ${this.#thing}`
                : surql`UPDATE ${this.#thing}`;

        if (this.#data) {
            query.append(surql` CONTENT ${this.#data}`);
        }

        return internalQuery(this.#connection, query, this.#json, this.#transaction);
    }
}
