import type { ConnectionController } from "../controller";
import { ExpressionError } from "../errors";
import { abortScope, addSignal, raceAbort, throwIfAborted } from "../internal/abort";
import { executeTransaction } from "../internal/transaction";
import type { QueryLike, Session, SqlExportOptions, TransactionOptions } from "../types";
import { ExportModelPromise, ExportPromise } from "./export";
import { ImportPromise } from "./import";
import { SurrealQueryable } from "./queryable";
import { SurrealTransaction } from "./transaction";

/**
 * A view of a session in which everything is bound to one or more `AbortSignal`s.
 *
 * It is created with `withSignal()`, which is how the work of a request handler is tied to the
 * signal of the request without passing it to every call: a query made through the scope is
 * abandoned when the signal aborts, exactly as if `.signal()` had been called on it, and a signal
 * given to `.signal()` in addition is combined with it. That includes a list of queries run with
 * `query([...])`, and an atomic `transaction([...])`.
 *
 * ```ts
 * export default {
 *     async fetch(request: Request) {
 *         const scoped = db.withSignal(request.signal);
 *         const people = await scoped.select(new Table("person"));
 *         return Response.json(people);
 *     },
 * };
 * ```
 *
 * A scope is a cheap object: it shares the connection and the session it was made from, owns
 * nothing, and does not need to be closed. It does not change the session, so it is safe to make
 * one per request on a connection shared between requests.
 *
 * Only queries are bound to the signal. **`live()` and `liveOf()` are not**: a subscription made
 * through a scope is not killed when the signal aborts, and keeps running until it is killed or the
 * connection closes. Kill it yourself, for example with
 * `signal.addEventListener("abort", () => subscription.kill())`. Neither are the calls which
 * change the session, such as `use()` and `signin()`, which a scope does not offer, or the
 * `commit()` and `cancel()` of a transaction, which are left alone so that a request which is being
 * abandoned cannot leave the outcome of a commit in doubt.
 */
export class SurrealRequestScope extends SurrealQueryable {
    readonly #connection: ConnectionController;
    readonly #session: Session;
    readonly #signals: readonly AbortSignal[];

    constructor(
        connection: ConnectionController,
        session: Session,
        signals: readonly AbortSignal[],
    ) {
        super(connection, session, undefined, signals);
        this.#connection = connection;
        this.#session = session;
        this.#signals = signals;
    }

    /**
     * Create a view of the same session in which everything is bound to a further signal as well.
     * The view is abandoned when this scope's signals abort, or the one given.
     *
     * @param signal The signal to add. Without one, the view is bound to the same signals as this.
     */
    withSignal(signal: AbortSignal | undefined): SurrealRequestScope {
        return new SurrealRequestScope(
            this.#connection,
            this.#session,
            addSignal(this.#signals, signal) ?? [],
        );
    }

    /**
     * Import an existing export into the database, abandoned when the signals of this scope abort.
     * See `Surreal.import()`.
     *
     * Like on `Surreal`, this acts on the connection and its default session: it does not use the
     * namespace, database or authentication of a session this scope was made from.
     *
     * @param input The data to import
     */
    import(input: string | Blob | ReadableStream): ImportPromise {
        return new ImportPromise(this.#connection, input, { signals: this.#signals });
    }

    /**
     * Export the database as SurrealQL, abandoned when the signals of this scope abort. See
     * `Surreal.export()`, and the note on `import()` about sessions.
     *
     * @param options Optional export options
     */
    export(options?: Partial<SqlExportOptions>): ExportPromise {
        return new ExportPromise(this.#connection, options ?? {}, false, {
            signals: this.#signals,
        });
    }

    /**
     * Export a SurrealML model, abandoned when the signals of this scope abort. See
     * `Surreal.exportModel()`, and the note on `import()` about sessions.
     *
     * @param name The name of the ML model to export
     * @param version The version of the ML model to export
     */
    exportModel(name: string, version: string): ExportModelPromise {
        return new ExportModelPromise(this.#connection, { name, version }, false, {
            signals: this.#signals,
        });
    }

    /**
     * Run a list of queries atomically, in a single request, abandoned when the signals of this scope
     * abort. See `SurrealSession.transaction()` for what the queries may be and what is resolved.
     *
     * The `signal` and `requestTimeout` of the options apply as well, combined with the signals of
     * this scope. If a signal aborts, the transaction stops waiting and fails with its reason, and a
     * transaction waiting to be retried is not retried again. Unlike a transaction begun with
     * `beginTransaction()`, whose commit is a request of its own which a signal leaves alone, this one
     * is a single request, commit included, which the server may carry on to run: **it may or may not
     * have been committed** when it is abandoned.
     *
     * @example
     * ```ts
     * const [from, to] = await db.withSignal(request.signal).transaction<[Account, Account]>([
     *     surql`UPDATE ONLY ${fromId} SET balance -= ${amount}`,
     *     surql`UPDATE ONLY ${toId} SET balance += ${amount}`,
     * ], { retry: true });
     * ```
     *
     * @param queries The queries to run, each of which can be a string, `BoundQuery`, query builder or `Query`
     * @param options Options to configure the transaction
     * @returns The result of each statement, in order
     */
    transaction<R extends unknown[] = unknown[]>(
        queries: readonly QueryLike[],
        options?: TransactionOptions,
    ): Promise<R>;

    // Shadow implementation, as for the session
    async transaction(queries: unknown, options?: TransactionOptions): Promise<unknown[]> {
        if (!Array.isArray(queries)) {
            throw new ExpressionError("transaction() expects an array of queries");
        }

        return executeTransaction(this.#connection, this.#session, queries, options, this.#signals);
    }

    /**
     * Start a transaction on the session, bound to the signals of this scope. Every query made in
     * the transaction is abandoned when they abort, and a transaction which is abandoned
     * before it is committed is not applied.
     *
     * Starting it is itself abandoned if the signal aborts first, in which case the transaction
     * which may already have begun on the server is cancelled. Committing is not: once a request
     * has decided to commit, a signal does not leave the outcome in doubt.
     *
     * @returns A new transaction instance
     */
    async beginTransaction(): Promise<SurrealTransaction> {
        const scope = abortScope(this.#signals);

        try {
            throwIfAborted(scope.signal);

            const id = await raceAbort(
                this.#connection.begin(this.#session),
                scope.signal,
                (late) => {
                    // The signal won the race, but the server began a transaction nobody holds
                    this.#connection.cancel(late, this.#session).catch(() => {});
                },
            );

            return new SurrealTransaction(this.#connection, this.#session, id, this.#signals);
        } finally {
            scope.dispose();
        }
    }
}
