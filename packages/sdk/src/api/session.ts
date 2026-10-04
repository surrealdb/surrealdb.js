import type { ConnectionController } from "../controller";
import { ExpressionError } from "../errors";
import { executeTransaction } from "../internal/transaction";
import type {
    AccessRecordAuth,
    AnyAuth,
    NamespaceDatabase,
    Nullable,
    QueryLike,
    Session,
    Token,
    Tokens,
    TransactionOptions,
} from "../types";
import { Publisher } from "../utils";
import { SurrealQueryable } from "./queryable";
import { SurrealTransaction } from "./transaction";

export type SessionEvents = {
    auth: [Tokens | null];
    using: [NamespaceDatabase];
};

/**
 * A scoped contextual session attached to a connection to SurrealDB.
 *
 * Note that most methods in this class are dispatched once you subscribe to the
 * returned Promise and offer various chainable configuration methods before
 * making the actual request.
 *
 * You can create a new derived session by calling the `forkSession` method.
 */
export class SurrealSession extends SurrealQueryable {
    readonly #publisher = new Publisher<SessionEvents>();
    readonly #connection: ConnectionController;
    readonly #session: Session;

    readonly #unsubAuth: () => void;
    readonly #unsubUsing: () => void;

    subscribe<K extends keyof SessionEvents>(
        event: K,
        listener: (...payload: SessionEvents[K]) => void,
    ): () => void {
        return this.#publisher.subscribe(event, listener);
    }

    constructor(connection: ConnectionController, session: Session) {
        super(connection, session);
        this.#connection = connection;
        this.#session = session;

        this.#unsubAuth = connection.subscribe("auth", (auth, session) => {
            if (session === this.#session) {
                this.#publisher.publish("auth", auth);
            }
        });

        this.#unsubUsing = connection.subscribe("using", (using, session) => {
            if (session === this.#session) {
                this.#publisher.publish("using", using);
            }
        });
    }

    /**
     * Returns the selected namespace
     */
    get namespace(): string | undefined {
        return this.#connection.getSession(this.#session).namespace;
    }

    /**
     * Returns the selected database
     */
    get database(): string | undefined {
        return this.#connection.getSession(this.#session).database;
    }

    /**
     * Returns the current authentication access token
     */
    get accessToken(): string | undefined {
        return this.#connection.getSession(this.#session).accessToken;
    }

    /**
     * Returns the parameters currently defined on the session
     */
    get parameters(): Record<string, unknown> {
        return this.#connection.getSession(this.#session).variables ?? {};
    }

    /**
     * Returns the ID of the current session. For the default session, undefined is returned.
     */
    get session(): Session {
        return this.#session;
    }

    /**
     * Returns whether the session is valid and can be used. This is always true for the default session,
     * however for other sessions it will be false after the session has been disposed.
     */
    get isValid(): boolean {
        return this.#connection.hasSession(this.#session);
    }

    // =========================================================== //
    //                                                             //
    //                  Session Management Methods                 //
    //                                                             //
    // =========================================================== //

    /**
     * Create a new session by cloning the current session and return a new `SurrealSession` instance scoped to it.
     *
     * This session will contain its own copy of global variables, namespace, database, and authentication state.
     * Connection related functions and event subscriptions will be shared with the original session. When the
     * connection reconnects, the session will be automatically restored.
     *
     * You can invoke `reset()` on the created session to destroy it, after which it cannot be used again.
     *
     * The following properties are inherited by the new session:
     * - namespace
     * - database
     * - variables
     * - authentication state
     *
     * @returns The new session
     */
    async forkSession(): Promise<SurrealSession> {
        const created = await this.#connection.createSession(this.#session);

        return SurrealSession.of(this, created);
    }

    /**
     * Closes the current session and disposes of it. After this method is called, the session cannot be used again,
     * and `isValid` will return `false`.
     */
    async closeSession(): Promise<void> {
        await this.#connection.destroySession(this.#session);

        this.#unsubAuth();
        this.#unsubUsing();
    }

    [Symbol.asyncDispose]() {
        return this.closeSession();
    }

    // =========================================================== //
    //                                                             //
    //                     Transaction Methods                     //
    //                                                             //
    // =========================================================== //

    /**
     * Create a new transaction scoped to the current session. Transactions allow you to execute
     * multiple queries atomically. When the desired queries have been executed, call `commit()` to apply the changes to the database.
     * If the transaction is no longer needed, call `cancel()` to discard the changes.
     *
     * @returns A new transaction instance
     */
    async beginTransaction(): Promise<SurrealTransaction> {
        const transactionId = await this.#connection.begin(this.#session);
        return new SurrealTransaction(this.#connection, this.#session, transactionId);
    }

    /**
     * Runs a list of queries atomically, in a single request.
     *
     * The queries are wrapped in `BEGIN` and `COMMIT` and sent together, so either all of
     * their changes are applied or none are. Unlike `beginTransaction()`, no state is held on
     * the connection, which means this works over HTTP as well as WebSockets.
     *
     * Resolves to the results of the queries, positional **per statement** in the same way as
     * `query([...])`: a query builder holds one statement, while a string holding three takes
     * three slots. Rejects with the error which made the transaction fail, rather than one of
     * the "not executed" errors which the server reports for the statements it rolled back.
     *
     * Each input can be a string, a `BoundQuery` (such as one created with the `surql` template
     * tag), a query builder (such as `select()` or `create()`) or a `Query` returned by `query()`.
     * They cannot contain `BEGIN`, `COMMIT` or `CANCEL` statements, nor a `RETURN` followed by
     * further statements, as `RETURN` ends a transaction early in SurrealQL: use `SELECT` or a
     * bare expression to produce a value instead. A `RETURN` nested inside a block, such as an
     * `IF`, ends the transaction in the same way but cannot be detected. Before SurrealDB 3.0 a
     * `RETURN` also replaces the results of the statements before it, so none is allowed at all.
     *
     * Because the queries are sent as one atomic request, they are safe to replay, and so a
     * transaction can opt into retrying when it fails due to a conflict with a concurrent
     * transaction, using the `retry` option or the `retry` configured on the connection. Only
     * SurrealDB 3.1.0 and later report a conflict in a way which the default retry recognizes:
     * for earlier versions, provide a `retryable` predicate as for `query().retry()`. It is given
     * the error which made the transaction fail, whichever version it is.
     *
     * @example
     * ```ts
     * const [from, to] = await db.transaction<[Account, Account]>([
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

    // Shadow implementation. The array form is told apart by its argument type, which leaves
    // room for an overload which takes a callback to run interactively.
    async transaction(queries: unknown, options?: TransactionOptions): Promise<unknown[]> {
        if (!Array.isArray(queries)) {
            throw new ExpressionError("transaction() expects an array of queries");
        }

        return executeTransaction(this.#connection, this.#session, queries, options);
    }

    // =========================================================== //
    //                                                             //
    //                       Session Methods                       //
    //                                                             //
    // =========================================================== //

    /**
     * Switch to the specified {@link https://surrealdb.com/docs/surrealdb/introduction/concepts/namespace|namespace}
     * and {@link https://surrealdb.com/docs/surrealdb/introduction/concepts/database|database}
     *
     * Leaving the namespace or database undefined will leave the current namespace or database unchanged,
     * while passing null will unset the selected namespace or database.
     *
     * @param database Switches to a specific namespace
     * @param db Switches to a specific database
     * @returns The newly selected namespace and database
     */
    async use(what?: Nullable<NamespaceDatabase>): Promise<NamespaceDatabase> {
        return await this.#connection.use(what ?? {}, this.#session);
    }

    /**
     * Sign up to the SurrealDB instance as a new
     * {@link https://surrealdb.com/docs/surrealdb/security/authentication#record-users|record user}.
     *
     * When this method is called, the `authentication` property passed to `connect()`
     * will be ignored. You will be reponsible for handling session invalidation
     * by listening to the `auth` event.
     *
     * @param auth The authentication details to use.
     * @return The authentication tokens.
     */
    signup(auth: AccessRecordAuth): Promise<Tokens> {
        return this.#connection.signup(auth, this.#session);
    }

    /**
     * Authenticate with the SurrealDB using the provided authentication details.
     *
     * When this method is called, the `authentication` property passed to `connect()`
     * will be ignored. You will be reponsible for handling session invalidation
     * by listening to the `auth` event.
     *
     * @param auth The authentication details to use.
     * @return The authentication tokens.
     */
    signin(auth: AnyAuth): Promise<Tokens> {
        return this.#connection.signin(auth, this.#session);
    }

    /**
     * Authenticates the current connection using an existing access token or
     * an access and refresh token combination.
     *
     * When authenticating with a refresh token, a new refresh token will be issued
     * and returned.
     *
     * When this method is called, the `authentication` property passed to `connect()`
     * will be ignored. You will be reponsible for handling session invalidation
     * by listening to the `auth` event.
     *
     * @param token The access token or access and refresh token combination.
     */
    async authenticate(token: Token | Tokens): Promise<Tokens> {
        if (typeof token === "object" && token.refresh) {
            return this.#connection.refresh(token, this.#session);
        }

        const access = typeof token === "string" ? token : token.access;
        await this.#connection.authenticate(access, this.#session);
        return { access };
    }

    /**
     * Define a global variable for the current socket connection
     *
     * @param key Specifies the name of the variable
     * @param val Assigns the value to the variable name
     */
    set(variable: string, value: unknown): Promise<void> {
        return this.#connection.set(variable, value, this.#session);
    }

    /**
     * Remove a variable from the current socket connection
     *
     * @param key Specifies the name of the variable.
     */
    unset(variable: string): Promise<void> {
        return this.#connection.unset(variable, this.#session);
    }

    /**
     * Invalidates the authentication for the current connection.
     */
    invalidate(): Promise<void> {
        return this.#connection.invalidate(this.#session);
    }

    /**
     * Resets the current session to its initial state, clearing
     * authentication state, variables, and selected namespace/database.
     */
    async reset(): Promise<void> {
        await this.#connection.reset(this.#session);
    }

    /**
     * Compose a new `SurrealSession` instance with the provided parent connection
     * and session ID.
     *
     * You likely won't need to use this method directly, but it can be useful when
     * you need to compose a new `SurrealSession` instance from an id.
     *
     * @param session The parent connection or session to reference
     * @param id The ID of the session
     * @returns A new `SurrealSession` representing the provided ID
     */
    static of(parent: SurrealSession, id: Session): SurrealSession {
        return new SurrealSession(parent.#connection, id);
    }
}
