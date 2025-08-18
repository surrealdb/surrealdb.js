import type { ConnectionController } from "../controller";
import { DispatchedPromise } from "../internal/dispatched-promise";
import { internalQuery } from "../internal/internal-query";
import { BoundQuery } from "../utils";
import type { Uuid } from "../value";

/**
 * A configurable `Promise` for retrieving auth information from a SurrealDB instance.
 */
export class AuthPromise<T, J extends boolean = false> extends DispatchedPromise<T> {
    #connection: ConnectionController;
    #transaction: Uuid | undefined;
    #json: J;

    constructor(connection: ConnectionController, transaction: Uuid | undefined, json: J) {
        super();
        this.#connection = connection;
        this.#transaction = transaction;
        this.#json = json;
    }

    /**
     * Configure the query to return the result of each response as a
     * JSON-compatible structure.
     *
     * This is useful when query results need to be serialized. Keep in mind
     * that your responses will lose SurrealDB type information.
     */
    json(): AuthPromise<T, true> {
        return new AuthPromise(this.#connection, this.#transaction, true);
    }

    /**
     * Attach this query to a specific transaction.
     *
     * @param transactionId The ID of the transaction to attach this query to
     */
    txn(transactionId: Uuid): AuthPromise<T, J> {
        return new AuthPromise(this.#connection, transactionId, this.#json);
    }

    protected async dispatch(): Promise<T> {
        await this.#connection.ready();

        return internalQuery(
            this.#connection,
            new BoundQuery("SELECT * FROM $auth"),
            this.#json,
            this.#transaction,
        );
    }
}
