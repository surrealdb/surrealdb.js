import type { ConnectionController } from "../controller";
import { DispatchedPromise } from "../internal/dispatched-promise";
import { internalQuery } from "../internal/internal-query";
import type { MaybeJsonify } from "../types/internal";
import { surql } from "../utils";
import { RecordId, type RecordIdRange, type Table, type Uuid } from "../value";

/**
 * A configurable `Promise` for a select query sent to a SurrealDB instance.
 */
export class SelectPromise<T, J extends boolean = false> extends DispatchedPromise<
    MaybeJsonify<T, J>
> {
    #connection: ConnectionController;
    #what: RecordId | RecordIdRange | Table;
    #transaction: Uuid | undefined;
    #json: J;

    constructor(connection: ConnectionController, what: RecordId | RecordIdRange | Table) {
        super();
        this.#connection = connection;
        this.#what = what;
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
    json(): SelectPromise<T, true> {
        const promise = new SelectPromise<T, true>(this.#connection, this.#what);
        promise.#transaction = this.#transaction;
        return promise;
    }

    /**
     * Attach this query to a specific transaction.
     *
     * @param transactionId The ID of the transaction to attach this query to
     */
    txn(transactionId: Uuid): SelectPromise<T, J> {
        const promise = new SelectPromise<T, J>(this.#connection, this.#what);
        promise.#transaction = transactionId;
        promise.#json = this.#json;
        return promise;
    }

    protected async dispatch(): Promise<MaybeJsonify<T, J>> {
        await this.#connection.ready();

        const query =
            this.#what instanceof RecordId
                ? surql`SELECT * FROM ONLY ${this.#what}`
                : surql`SELECT * FROM ${this.#what}`;

        return internalQuery(this.#connection, query, this.#json, this.#transaction);
    }
}
