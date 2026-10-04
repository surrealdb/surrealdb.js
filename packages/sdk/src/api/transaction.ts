import type { Uuid } from "@surrealdb/sqon";
import type { ConnectionController } from "../controller";
import { ConnectionUnavailableError } from "../errors";
import { addSignal } from "../internal/abort";
import type { Session } from "../types";
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
    #signals: readonly AbortSignal[] | undefined;

    constructor(
        connection: ConnectionController,
        session: Session,
        transaction: Uuid,
        signals?: readonly AbortSignal[],
    ) {
        super(connection, session, transaction, signals);
        this.#connection = connection;
        this.#session = session;
        this.#transaction = transaction;
        this.#signals = signals;
    }

    /**
     * Create a handle on this same transaction in which every query is also bound to a signal.
     *
     * The handle commits and cancels the transaction just as this one does. Only queries are bound
     * to the signal: `commit()` and `cancel()` are not, so a request which is being abandoned cannot
     * leave the outcome of a commit in doubt. See `SurrealRequestScope`.
     *
     * @param signal The signal to add. Without one, the handle is bound to the same signals as this.
     */
    withSignal(signal: AbortSignal | undefined): SurrealTransaction {
        return new SurrealTransaction(
            this.#connection,
            this.#session,
            this.#transaction,
            addSignal(this.#signals, signal),
        );
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
