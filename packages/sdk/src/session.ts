import type { ConnectionController } from "./controller";
import {
    AuthPromise,
    CreatePromise,
    DeletePromise,
    InsertPromise,
    ManagedLivePromise,
    Query,
    RelatePromise,
    RunPromise,
    SelectPromise,
    UnmanagedLivePromise,
    UpdatePromise,
    UpsertPromise,
} from "./query";
import type {
    AccessRecordAuth,
    AnyAuth,
    AnyRecordId,
    AuthResponse,
    LiveResource,
    NamespaceDatabase,
    Nullable,
    RecordResult,
    Session,
    Token,
    Values,
} from "./types";
import { BoundQuery } from "./utils";
import { type RecordId, type RecordIdRange, Table, type Uuid } from "./value";

/**
 * A scoped contextual session attached to a connection to SurrealDB.
 *
 * Note that most methods in this class are dispatched once you subscribe to the
 * returned Promise and offer various chainable configuration methods before
 * making the actual request.
 *
 * You can create a new derived session by calling the `forkSession` method.
 */
export class SurrealSession {
    readonly #connection: ConnectionController;
    readonly #session: Uuid | undefined;

    constructor(connection: ConnectionController, session: Session) {
        this.#connection = connection;
        this.#session = session;
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
        const session = await this.#connection.createSession(this.#session);

        return new SurrealSession(this.#connection, session);
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
    async use(what: Nullable<NamespaceDatabase>): Promise<NamespaceDatabase> {
        await this.#connection.use(what, this.#session);

        return {
            namespace: this.namespace,
            database: this.database,
        };
    }

    /**
     * Sign up to the SurrealDB instance as a new
     * {@link https://surrealdb.com/docs/surrealdb/security/authentication#record-users|record user}.
     *
     * @param auth The authentication details to use.
     * @return The authentication tokens.
     */
    signup(auth: AccessRecordAuth): Promise<AuthResponse> {
        return this.#connection.signup(auth, this.#session);
    }

    /**
     * Authenticate with the SurrealDB using the provided authentication details.
     *
     * @param auth The authentication details to use.
     * @return The authentication tokens.
     */
    signin(auth: AnyAuth): Promise<AuthResponse> {
        return this.#connection.signin(auth, this.#session);
    }

    /**
     * Authenticates the current connection with a JWT token.
     *
     * @param token The JWT authentication token.
     */
    authenticate(token: Token): Promise<void> {
        return this.#connection.authenticate(token, this.#session);
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
     *
     * If this is not the default session, the session will be disposed and cannot be used again.
     */
    async reset(): Promise<void> {
        await this.#connection.reset(this.#session);
    }

    // =========================================================== //
    //                                                             //
    //                        Query Methods                        //
    //                                                             //
    // =========================================================== //

    /**
     * Runs a set of SurrealQL statements against the database.
     *
     * The resulting `Query` instance can be awaited to execute the query, however you will
     * need to use the `.collect()` or `.stream()` methods to process result values.
     *
     * @param query Specifies the SurrealQL statements
     * @param bindings Assigns variables which can be used in the query
     * @returns A `Query` instance which can be used to execute or configure the query
     */
    query(query: string, bindings?: Record<string, unknown>): Query;

    /**
     * Runs a set of SurrealQL statements against the database.
     *
     * The resulting `Query` instance can be awaited to execute the query, however you will
     * need to use the `.collect()` or `.stream()` methods to process result values.
     *
     * @param query The BoundQuery instance
     * @returns A `Query` instance which can be used to execute or configure the query
     */
    query<R extends unknown[] = unknown[]>(query: BoundQuery<R>): Query<R>;

    // Shadow implementation
    query(query: string | BoundQuery, bindings?: Record<string, unknown>): Query {
        return new Query(this.#connection, {
            query: query instanceof BoundQuery ? query : new BoundQuery(query, bindings),
            transaction: undefined,
            session: this.#session,
            json: false,
        });
    }

    /**
     * Returns the record representing the currently authenticated record user by
     * selecting the [$auth parameter](https://surrealdb.com/docs/surrealql/parameters#auth).
     *
     * Make sure the user actually has the permission to select their own record, otherwise you'll get back an empty result
     *
     * @return The record linked to the record ID used for authentication
     */
    auth<T>(): AuthPromise<RecordResult<T> | undefined> {
        return new AuthPromise(this.#connection, {
            transaction: undefined,
            session: this.#session,
            json: false,
        });
    }

    /**
     * Create a new live subscription to a specific table, record id, or record id range
     *
     * @param what The table, record id, or record id range to subscribe to
     * @returns A new live subscription object
     */
    live<T>(what: LiveResource): ManagedLivePromise<T> {
        return new ManagedLivePromise(this.#connection, {
            what,
            session: this.#session,
        });
    }

    /**
     * Manually subscribe to an existing live subscription using the provided ID
     *
     * **NOTE:** This function is for use with live select queries that are not managed by the driver.
     *
     * @param id The ID of the live subscription to subscribe to
     * @returns A new unmanaged live subscription object
     */
    liveOf(id: Uuid): UnmanagedLivePromise {
        return new UnmanagedLivePromise(this.#connection, {
            id,
            session: this.#session,
        });
    }

    /**
     * Select the contents of a specific record based on the provied Record ID
     *
     * @param recordId The record ID to select
     */
    select<T>(recordId: RecordId): SelectPromise<RecordResult<T> | undefined, T>;

    /**
     * Select all records based on the provided Record ID range
     *
     * @param range The range of record IDs to select
     */
    select<T>(range: RecordIdRange): SelectPromise<RecordResult<T>[], T>;

    /**
     * Select all records present in the specified table
     *
     * @param recordId The record ID to select
     */
    select<T>(table: Table): SelectPromise<RecordResult<T>[], T>;

    // Shadow implementation
    select(what: RecordId | RecordIdRange | Table): unknown {
        return new SelectPromise(this.#connection, {
            what,
            transaction: undefined,
            session: this.#session,
            json: false,
        });
    }

    /**
     * Create a new record in the database
     *
     * @param recordId The record id of the record to create
     */
    create<T>(recordId: RecordId): CreatePromise<RecordResult<T>, T>;

    /**
     * Create a new record in the specified table
     *
     * @param table The table to create a record in
     */
    create<T>(table: Table): CreatePromise<RecordResult<T>[], T>;

    // Shadow implementation
    create(what: RecordId | Table): unknown {
        return new CreatePromise(this.#connection, {
            what,
            transaction: undefined,
            session: this.#session,
            json: false,
        });
    }

    /**
     * Create a graph edge between the from record and the to record using the specified edge
     *
     * @param from The in property on the edge record
     * @param edge The id or table of the edge record
     * @param to  The out property on the edge record
     * @param data The optional record data to store on the edge
     */
    relate<T>(
        from: AnyRecordId,
        edge: Table | RecordId,
        to: AnyRecordId,
        data?: Values<T>,
    ): RelatePromise<T>;

    /**
     * Create multiple graph edges between the from records and the to records using the specified edge
     *
     * @param from The in properties on the edge records
     * @param edge The edge table to create the relation in
     * @param to  The out property on the edge record
     * @param data The optional record data to store on the edge
     */
    relate<T>(
        from: AnyRecordId[],
        edge: Table,
        to: AnyRecordId[],
        data?: Partial<T>,
    ): RelatePromise<T[]>;

    // Shadow implementation
    relate<T>(
        from: AnyRecordId | AnyRecordId[],
        what: Table | RecordId,
        to: AnyRecordId | AnyRecordId[],
        data?: Partial<T>,
    ): unknown {
        return new RelatePromise(this.#connection, {
            from,
            what,
            to,
            data,
            transaction: undefined,
            session: this.#session,
            json: false,
        });
    }

    /**
     * Inserts one or multiple records into the database
     *
     * @param data One or more records to insert
     */
    insert<T>(data: Values<T> | Values<T>[]): InsertPromise<RecordResult<T>[]>;

    /**
     * Inserts one or multiple records into the database
     *
     * @param table The table to insert the record into
     * @param data One or more records to insert
     */
    insert<T>(table: Table, data: Values<T> | Values<T>[]): InsertPromise<RecordResult<T>[]>;

    // Shadow implementation
    insert<T>(arg1: Table | Values<T> | Values<T>[], arg2?: Values<T> | Values<T>[]): unknown {
        if (arg1 instanceof Table) {
            return new InsertPromise(this.#connection, {
                table: arg1,
                what: arg2 ?? [],
                transaction: undefined,
                session: this.#session,
                json: false,
            });
        }

        return new InsertPromise(this.#connection, {
            table: undefined,
            what: arg1,
            transaction: undefined,
            session: this.#session,
            json: false,
        });
    }

    /**
     * Updates a single record based on the provided Record ID
     *
     * @param recordId The record ID to update
     */
    update<T>(recordId: RecordId): UpdatePromise<RecordResult<T>, T>;

    /**
     * Updates all records based on the provided Record ID range
     *
     * @param range The range of record IDs to update
     */
    update<T>(range: RecordIdRange): UpdatePromise<RecordResult<T>[], T>;

    /**
     * Updates all records present in the specified table
     *
     * @param table The table to update
     */
    update<T>(table: Table): UpdatePromise<RecordResult<T>[], T>;

    // Shadow implementation
    update(what: RecordId | RecordIdRange | Table): unknown {
        return new UpdatePromise(this.#connection, {
            what,
            transaction: undefined,
            session: this.#session,
            json: false,
        });
    }

    /**
     * Upserts a single record based on the provided Record ID
     *
     * **NOTE**: This function replaces the existing record data with the specified data**
     *
     * @param recordId The record ID to upsert
     * @param data The record data to upsert
     */
    upsert<T>(recordId: RecordId): UpsertPromise<RecordResult<T>, T>;

    /**
     * Upserts all records based on the provided Record ID range
     *
     * **NOTE**: This function replaces the existing record data with the specified data**
     *
     * @param range The range of record IDs to upsert
     * @param data The record data to upsert
     */
    upsert<T>(range: RecordIdRange): UpsertPromise<RecordResult<T>[], T>;

    /**
     * Upserts all records present in the specified table
     *
     * **NOTE**: This function replaces the existing record data with the specified data**
     *
     * @param table The table to upsert
     * @param data The record data to upsert
     */
    upsert<T>(table: Table): UpsertPromise<RecordResult<T>[], T>;

    // Shadow implementation
    upsert(what: RecordId | RecordIdRange | Table): unknown {
        return new UpsertPromise(this.#connection, {
            what,
            transaction: undefined,
            session: this.#session,
            json: false,
        });
    }

    /**
     * Deletes a single record from the database based on the provided Record ID
     *
     * @param recordId The record ID to delete
     */
    delete<T>(recordId: RecordId): DeletePromise<RecordResult<T>>;

    /**
     * Deletes all records based on the provided Record ID range
     *
     * @param range The range of record IDs to delete
     */
    delete<T>(range: RecordIdRange): DeletePromise<RecordResult<T>[]>;

    /**
     * Deletes all records present in the specified table
     *
     * @param table The table to delete
     */
    delete<T>(table: Table): DeletePromise<RecordResult<T>[]>;

    // Shadow implementation
    delete(what: RecordId | RecordIdRange | Table): unknown {
        return new DeletePromise(this.#connection, {
            what,
            output: "before",
            transaction: undefined,
            session: this.#session,
            json: false,
        });
    }

    /**
     * Run a SurrealQL function and return the result
     *
     * @param name The full name of the function to run
     * @param args The arguments supplied to the function
     */
    run<T>(name: string, args?: unknown[]): RunPromise<T>;

    /**
     * Run a SurrealML function with the specified version and return the result
     *
     * @param name The full name of the function to run
     * @param version The version of the function to use
     * @param args The arguments supplied to the function
     */
    run<T>(name: string, version: string, args?: unknown[]): RunPromise<T>;

    // Shadow implementation
    run(name: string, arg2?: string | unknown[], arg3?: unknown[]): unknown {
        if (typeof arg2 === "string") {
            return new RunPromise(this.#connection, {
                name,
                version: arg2,
                args: arg3 ?? [],
                transaction: undefined,
                session: this.#session,
                json: false,
            });
        }

        return new RunPromise(this.#connection, {
            name,
            version: undefined,
            args: arg2 ?? [],
            transaction: undefined,
            session: this.#session,
            json: false,
        });
    }
}
