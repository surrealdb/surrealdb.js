import type { ConnectionController } from "../controller";
import { DispatchedPromise } from "../internal/dispatched-promise";
import { internalQuery } from "../internal/internal-query";
import type { Doc } from "../types";
import type { MaybeJsonify } from "../types/internal";
import { surql } from "../utils";
import type { Table, Uuid } from "../value";

/**
 * A configurable `Promise` for an insert query sent to a SurrealDB instance.
 */
export class InsertPromise<T, U extends Doc, J extends boolean = false> extends DispatchedPromise<
    MaybeJsonify<T, J>
> {
    #connection: ConnectionController;
    #table: Table | undefined;
    #what: U | U[];
    #transaction: Uuid | undefined;
    #json: J;

    constructor(connection: ConnectionController, table: Table | undefined, what: U | U[]) {
        super();
        this.#connection = connection;
        this.#table = table;
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
    json(): InsertPromise<T, U, true> {
        const promise = new InsertPromise<T, U, true>(this.#connection, this.#table, this.#what);
        promise.#transaction = this.#transaction;
        return promise;
    }

    /**
     * Attach this query to a specific transaction.
     *
     * @param transactionId The ID of the transaction to attach this query to
     */
    txn(transactionId: Uuid): InsertPromise<T, U, J> {
        const promise = new InsertPromise<T, U, J>(this.#connection, this.#table, this.#what);
        promise.#transaction = transactionId;
        promise.#json = this.#json;
        return promise;
    }

    protected async dispatch(): Promise<MaybeJsonify<T, J>> {
        await this.#connection.ready();

        const query = surql`INSERT`;

        if (this.#table) {
            query.append(surql` INTO ${this.#table}`);
        }

        query.append(surql` ${this.#what}`);

        return internalQuery(this.#connection, query, this.#json, this.#transaction);
    }
}
