import type { ConnectionController } from "../controller";
import { ConnectionUnavailableError } from "../errors";
import type { Session } from "../types";
import type { Uuid } from "../value";
import { SurrealQueryable } from "./queryable";

/**
 * A query transaction scoped to a session used to execute multiple queries atomically.
 *
 * When the desired queries have been executed, call `commit()` to apply the changes to the database.
 * If the transaction is no longer needed, call `cancel()` to discard the changes.
 */
export class SurrealTransaction extends SurrealQueryable {
    #connection: ConnectionController;
    #session: Session;
    #transaction: Uuid;

    constructor(connection: ConnectionController, session: Session, transaction: Uuid) {
        super(connection, session, transaction);
        this.#connection = connection;
        this.#session = session;
        this.#transaction = transaction;
    }

    /**
     * Commit this transaction to the datastore.
     */
    commit(): Promise<void> {
        if (!this.#connection) throw new ConnectionUnavailableError();
        return this.#connection.commit(this.#transaction, this.#session);
    }

    /**
     * Cancel and discard the changes made in this transaction.
     */
    cancel(): Promise<void> {
        if (!this.#connection) throw new ConnectionUnavailableError();
        return this.#connection.cancel(this.#transaction, this.#session);
    }
}
