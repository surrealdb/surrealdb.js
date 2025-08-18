import type { ConnectionController } from "../controller";
import { DispatchedPromise } from "../internal/dispatched-promise";
import { internalQuery } from "../internal/internal-query";
import type { Doc, RelateInOut } from "../types";
import type { MaybeJsonify } from "../types/internal";
import { surql } from "../utils";
import type { RecordId, Table, Uuid } from "../value";

/**
 * A configurable `Promise` for a relate query sent to a SurrealDB instance.
 */
export class RelatePromise<T, U extends Doc, J extends boolean = false> extends DispatchedPromise<
    MaybeJsonify<T, J>
> {
    #connection: ConnectionController;
    #from: RelateInOut;
    #what: Table | RecordId;
    #to: RelateInOut;
    #data?: U;
    #transaction: Uuid | undefined;
    #json: J;

    constructor(
        connection: ConnectionController,
        from: RelateInOut,
        what: Table | RecordId,
        to: RelateInOut,
        data?: U,
    ) {
        super();
        this.#connection = connection;
        this.#from = from;
        this.#what = what;
        this.#to = to;
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
    json(): RelatePromise<T, U, true> {
        const promise = new RelatePromise<T, U, true>(
            this.#connection,
            this.#from,
            this.#what,
            this.#to,
            this.#data,
        );
        promise.#transaction = this.#transaction;
        return promise;
    }

    /**
     * Attach this query to a specific transaction.
     *
     * @param transactionId The ID of the transaction to attach this query to
     */
    txn(transactionId: Uuid): RelatePromise<T, U, J> {
        const promise = new RelatePromise<T, U, J>(
            this.#connection,
            this.#from,
            this.#what,
            this.#to,
            this.#data,
        );
        promise.#transaction = transactionId;
        promise.#json = this.#json;
        return promise;
    }

    protected async dispatch(): Promise<MaybeJsonify<T, J>> {
        await this.#connection.ready();

        const query = surql`RELATE ${this.#from}->${this.#what}->${this.#to}`;

        if (this.#data) {
            query.append(surql` CONTENT ${this.#data}`);
        }

        return internalQuery(this.#connection, query, this.#json, this.#transaction);
    }
}
