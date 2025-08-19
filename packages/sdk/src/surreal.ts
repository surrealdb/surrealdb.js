import { decodeCbor, encodeCbor } from "./cbor";
import { ConnectionController } from "./controller";
import { parseEndpoint } from "./internal/http";
import {
    AuthPromise,
    CreatePromise,
    DeletePromise,
    InsertPromise,
    ManagedLivePromise,
    QueryPromise,
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
    AuthResponse,
    ConnectionStatus,
    ConnectOptions,
    Doc,
    DriverOptions,
    EventPublisher,
    LiveResource,
    NamespaceDatabase,
    RecordResult,
    RelateInOut,
    SqlExportOptions,
    Token,
    Version,
    VersionInfo,
} from "./types";
import { BoundQuery } from "./utils";
import { Publisher } from "./utils/publisher";
import { type RecordId, type RecordIdRange, Table, type Uuid } from "./value";

export type SurrealEvents = {
    connecting: [];
    connected: [];
    reconnecting: [];
    disconnected: [];
    error: [Error];
    authenticated: [Token];
    invalidated: [];
};

/**
 * An interface for communicating to SurrealDB supporting connecting,
 * authentication, and querying.
 *
 * Note that most methods in this class are dispatched once you subscribe to the
 * returned Promise and offer various chainable configuration methods before
 * making the actual request.
 */
export class Surreal implements EventPublisher<SurrealEvents> {
    readonly #publisher = new Publisher<SurrealEvents>();
    readonly #connection: ConnectionController;

    subscribe<K extends keyof SurrealEvents>(
        event: K,
        listener: (...payload: SurrealEvents[K]) => void,
    ): () => void {
        return this.#publisher.subscribe(event, listener);
    }

    constructor(options: DriverOptions = {}) {
        this.#connection = new ConnectionController({
            options,
            encode: encodeCbor,
            decode: decodeCbor,
        });

        this.#connection.subscribe("connecting", () => this.#publisher.publish("connecting"));
        this.#connection.subscribe("connected", () => this.#publisher.publish("connected"));
        this.#connection.subscribe("disconnected", () => this.#publisher.publish("disconnected"));
        this.#connection.subscribe("reconnecting", () => this.#publisher.publish("reconnecting"));
        this.#connection.subscribe("error", (error) => this.#publisher.publish("error", error));

        this.#connection.subscribe("authenticated", (token) =>
            this.#publisher.publish("authenticated", token),
        );

        this.#connection.subscribe("invalidated", () => this.#publisher.publish("invalidated"));
    }

    /**
     * Connect to a local or remote SurrealDB instance using the provided URL
     *
     * @param url The endpoint to connect to
     * @param opts Options to configure the connection
     */
    async connect(url: string | URL, opts: ConnectOptions = {}): Promise<true> {
        return this.#connection.connect(parseEndpoint(url), opts);
    }

    /**
     * Disconnect from the active SurrealDB instance
     */
    async close(): Promise<true> {
        return this.#connection.disconnect();
    }

    /**
     * Returns the active selected namespace
     */
    get namespace(): string | undefined {
        return this.#connection.state?.namespace;
    }

    /**
     * Returns the active selected database
     */
    get database(): string | undefined {
        return this.#connection.state?.database;
    }

    /**
     * Returns the currently used authentication access token
     */
    get accessToken(): string | undefined {
        return this.#connection.state?.accessToken;
    }

    /**
     * Returns the parameters currently defined on the connection
     */
    get parameters(): Record<string, unknown> {
        return this.#connection.state?.variables ?? {};
    }

    /**
     * Returns the status of the connection
     */
    get status(): ConnectionStatus {
        return this.#connection.status;
    }

    /**
     * Returns whether the connection is considered connected
     *
     * Equivalent to `this.status === "connected"`
     */
    get isConnected(): boolean {
        return this.#connection.status === "connected";
    }

    /**
     * A promise which resolves when the connection is ready, or rejects
     * if a connection error occurs.
     */
    get ready(): Promise<void> {
        return this.#connection.ready();
    }

    // =========================================================== //
    //                                                             //
    //                     Connection Methods                      //
    //                                                             //
    // =========================================================== //

    /**
     * Check the health of the connected SurrealDB instance
     *
     * @returns The health of the connected SurrealDB instance
     */
    health(): Promise<void> {
        return this.#connection.health();
    }

    /**
     * Retrieves the version of the connected SurrealDB instance
     *
     * @example { version: "surrealdb-2.1.0" }
     */
    version(): Promise<VersionInfo> {
        return this.#connection.version();
    }

    // =========================================================== //
    //                                                             //
    //                       Session Methods                       //
    //                                                             //
    // =========================================================== //

    /**
     * Sign up to the SurrealDB instance as a new
     * {@link https://surrealdb.com/docs/surrealdb/security/authentication#record-users|record user}.
     *
     * @param auth The authentication details to use.
     * @return The authentication tokens.
     */
    signup(auth: AccessRecordAuth): Promise<AuthResponse> {
        return this.#connection.signup(auth);
    }

    /**
     * Authenticate with the SurrealDB using the provided authentication details.
     *
     * @param auth The authentication details to use.
     * @return The authentication tokens.
     */
    signin(auth: AnyAuth): Promise<AuthResponse> {
        return this.#connection.signin(auth);
    }

    /**
     * Authenticates the current connection with a JWT token.
     *
     * @param token The JWT authentication token.
     */
    authenticate(token: Token): Promise<void> {
        return this.#connection.authenticate(token);
    }

    /**
     * Switch to the specified {@link https://surrealdb.com/docs/surrealdb/introduction/concepts/namespace|namespace}
     * and {@link https://surrealdb.com/docs/surrealdb/introduction/concepts/database|database}
     *
     * @param database Switches to a specific namespace
     * @param db Switches to a specific database
     */
    use(what: Partial<NamespaceDatabase>): Promise<NamespaceDatabase> {
        return this.#connection.use(what);
    }

    /**
     * Define a global variable for the current socket connection
     *
     * @param key Specifies the name of the variable
     * @param val Assigns the value to the variable name
     */
    set(variable: string, value: unknown): Promise<void> {
        return this.#connection.set(variable, value);
    }

    /**
     * Remove a variable from the current socket connection
     *
     * @param key Specifies the name of the variable.
     */
    unset(variable: string): Promise<void> {
        return this.#connection.unset(variable);
    }

    /**
     * Invalidates the authentication for the current connection.
     */
    invalidate(): Promise<void> {
        return this.#connection.invalidate();
    }

    /**
     * Resets the current session to its initial state, clearing
     * authentication state, variables, and selected namespace/database.
     */
    reset(): Promise<void> {
        return this.#connection.reset();
    }

    // =========================================================== //
    //                                                             //
    //                  Data Management Methods                    //
    //                                                             //
    // =========================================================== //

    /**
     * Export the database and return the result as a string
     *
     * @param options Optional export options
     */
    public async export(options?: Partial<SqlExportOptions>): Promise<string> {
        await this.ready;
        return this.#connection.exportSql(options ?? {});
    }

    /**
     * Import an existing export into the database
     *
     * @param input The data to import
     */
    public async import(input: string): Promise<void> {
        await this.ready;
        return this.#connection.importSql(input);
    }

    // =========================================================== //
    //                                                             //
    //                        Query Methods                        //
    //                                                             //
    // =========================================================== //

    /**
     * Runs a set of SurrealQL statements against the database, returning the first error
     * if any of the statements result in an error
     *
     * @param query Specifies the SurrealQL statements
     * @param bindings Assigns variables which can be used in the query
     */
    query<T extends unknown[]>(
        query: string,
        bindings?: Record<string, unknown>,
    ): QueryPromise<T, "results", false>;

    /**
     * Runs a set of SurrealQL statements against the database, returning the first error
     * if any of the statements result in an error
     *
     * @param query The BoundQuery instance
     */
    query<T extends unknown[]>(query: BoundQuery): QueryPromise<T, "results", false>;

    // Shadow implementation
    query<T extends unknown[]>(
        query: string | BoundQuery,
        bindings?: Record<string, unknown>,
    ): QueryPromise<T> {
        const _query = query instanceof BoundQuery ? query.query : query;
        const _bindings = query instanceof BoundQuery ? query.bindings : bindings;

        return new QueryPromise(this.#connection, _query, _bindings, undefined, false, "results");
    }

    /**
     * Returns the record representing the currently authenticated record user by
     * selecting the [$auth parameter](https://surrealdb.com/docs/surrealql/parameters#auth).
     *
     * Make sure the user actually has the permission to select their own record, otherwise you'll get back an empty result
     *
     * @return The record linked to the record ID used for authentication
     */
    auth<T extends Doc>(): AuthPromise<RecordResult<T> | undefined> {
        return new AuthPromise(this.#connection, undefined, false);
    }

    /**
     * Create a new live subscription to a specific table, record id, or record id range
     *
     * @param what The table, record id, or record id range to subscribe to
     * @returns A new live subscription object
     */
    live(what: LiveResource): ManagedLivePromise {
        return new ManagedLivePromise(this.#connection, this.#publisher, what, false);
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
        return new UnmanagedLivePromise(this.#connection, id);
    }

    /**
     * Select all fields from a specific record based on the provied Record ID
     *
     * @param recordId The record ID to select
     */
    select<T extends Doc>(recordId: RecordId): SelectPromise<RecordResult<T>>;

    /**
     * Select all records based on the provided Record ID range
     *
     * @param range The range of record IDs to select
     */
    select<T extends Doc>(range: RecordIdRange): SelectPromise<RecordResult<T>[]>;

    /**
     * Select all records present in the specified table
     *
     * @param recordId The record ID to select
     */
    select<T extends Doc>(table: Table): SelectPromise<RecordResult<T>[]>;

    // Shadow implementation
    select(what: RecordId | RecordIdRange | Table): unknown {
        return new SelectPromise(this.#connection, what);
    }

    /**
     * Create a new record in the database
     *
     * @param recordId The record id of the record to create
     * @param data The record data to insert
     */
    create<T extends Doc, U extends Doc = T>(
        recordId: RecordId,
        data?: U,
    ): CreatePromise<RecordResult<T>, U>;

    /**
     * Create a new record in the specified table
     *
     * @param table The table to create a record in
     * @param data The record data to insert
     */
    create<T extends Doc, U extends Doc = T>(
        table: Table,
        data?: U,
    ): CreatePromise<RecordResult<T>[], U>;

    // Shadow implementation
    create<T extends Doc, U extends Doc = T>(what: RecordId | Table, data?: U): unknown {
        return new CreatePromise(this.#connection, what, data);
    }

    /**
     * Create a graph edge between the from record(s) and the to record(s) using a specific edge record id
     *
     * @param from The in property on the edge record
     * @param edge The id of the edge record
     * @param to  The out property on the edge record
     * @param data The optional record data to store on the edge
     */
    relate<T extends Doc, U extends Doc = T>(
        from: RelateInOut,
        edge: RecordId,
        to: RelateInOut,
        data?: U,
    ): RelatePromise<T, U>;

    /**
     * Create a graph edge between the from record(s) and the to record(s) on the specified edge table
     *
     * @param from The in property on the edge record
     * @param edge The edge table to create the relation in
     * @param to  The out property on the edge record
     * @param data The optional record data to store on the edge
     */
    relate<T extends Doc, U extends Doc = T>(
        from: RelateInOut,
        edge: Table,
        to: RelateInOut,
        data?: U,
    ): RelatePromise<T[], U>;

    // Shadow implementation
    relate<T extends Doc, U extends Doc = T>(
        from: RelateInOut,
        thing: Table | RecordId,
        to: RelateInOut,
        data?: U,
    ): unknown {
        return new RelatePromise(this.#connection, from, thing, to, data);
    }

    /**
     * Inserts one or multiple records into the database
     *
     * @param data One or more records to insert
     */
    insert<T extends Doc, U extends Doc = T>(data?: U | U[]): InsertPromise<RecordResult<T>[], U>;

    /**
     * Inserts one or multiple records into the database
     *
     * @param table The table to insert the record into
     * @param data One or more records to insert
     */
    insert<T extends Doc, U extends Doc = T>(
        table: Table,
        data?: U | U[],
    ): InsertPromise<RecordResult<T>[], U>;

    // Shadow implementation
    insert<T extends Doc, U extends Doc = T>(arg1: Table | U | U[], arg2?: U | U[]): unknown {
        if (arg1 instanceof Table) {
            return new InsertPromise(this.#connection, arg1, arg2 ?? []);
        }

        return new InsertPromise(this.#connection, undefined, arg1);
    }

    /**
     * Updates a single record based on the provided Record ID
     *
     * **NOTE**: This function replaces the existing record data with the specified data***
     *
     * @param recordId The record ID to update
     * @param data The record data to update
     */
    update<T extends Doc, U extends Doc = T>(
        recordId: RecordId,
        data?: U,
    ): UpdatePromise<RecordResult<T>, U>;

    /**
     * Updates all records based on the provided Record ID range
     *
     * **NOTE**: This function replaces the existing record data with the specified data***
     *
     * @param range The range of record IDs to update
     * @param data The record data to update
     */
    update<T extends Doc, U extends Doc = T>(
        range: RecordIdRange,
        data?: U,
    ): UpdatePromise<RecordResult<T>[], U>;

    /**
     * Updates all records present in the specified table
     *
     * **NOTE**: This function replaces the existing record data with the specified data***
     *
     * @param table The table to update
     * @param data The record data to update
     */
    update<T extends Doc, U extends Doc = T>(
        range: Table,
        data?: U,
    ): UpdatePromise<RecordResult<T>[], U>;

    // Shadow implementation
    update<T extends Doc, U extends Doc = T>(
        thing: RecordId | RecordIdRange | Table,
        data?: U,
    ): unknown {
        return new UpdatePromise(this.#connection, thing, data);
    }

    /**
     * Upserts a single record based on the provided Record ID
     *
     * **NOTE**: This function replaces the existing record data with the specified data**
     *
     * @param recordId The record ID to upsert
     * @param data The record data to upsert
     */
    upsert<T extends Doc, U extends Doc = T>(
        recordId: RecordId,
        data?: U,
    ): UpsertPromise<RecordResult<T>, U>;

    /**
     * Upserts all records based on the provided Record ID range
     *
     * **NOTE**: This function replaces the existing record data with the specified data**
     *
     * @param range The range of record IDs to upsert
     * @param data The record data to upsert
     */
    upsert<T extends Doc, U extends Doc = T>(
        thing: RecordIdRange,
        data?: U,
    ): UpsertPromise<RecordResult<T>[], U>;

    /**
     * Upserts all records present in the specified table
     *
     * **NOTE**: This function replaces the existing record data with the specified data**
     *
     * @param table The table to upsert
     * @param data The record data to upsert
     */
    upsert<T extends Doc, U extends Doc = T>(
        thing: Table,
        data?: U,
    ): UpsertPromise<RecordResult<T>[], U>;

    // Shadow implementation
    upsert<T extends Doc, U extends Doc = T>(
        thing: RecordId | RecordIdRange | Table,
        data?: U,
    ): unknown {
        return new UpsertPromise(this.#connection, thing, data);
    }

    /**
     * Deletes a single record from the database based on the provided Record ID
     *
     * @param recordId The record ID to delete
     */
    delete<T extends Doc>(recordId: RecordId): DeletePromise<RecordResult<T>>;

    /**
     * Deletes all records based on the provided Record ID range
     *
     * @param range The range of record IDs to delete
     */
    delete<T extends Doc>(thing: RecordIdRange): DeletePromise<RecordResult<T>[]>;

    /**
     * Deletes all records present in the specified table
     *
     * @param table The table to delete
     */
    delete<T extends Doc>(table: Table): DeletePromise<RecordResult<T>[]>;

    // Shadow implementation
    delete(what: RecordId | RecordIdRange | Table): unknown {
        return new DeletePromise(this.#connection, what);
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
    run<T>(name: string, version: Version, args?: unknown[]): RunPromise<T>;

    // Shadow implementation
    run(name: string, arg2?: Version | unknown[], arg3?: unknown[]): unknown {
        if (typeof arg2 === "string") {
            return new RunPromise(this.#connection, name, arg2, arg3 ?? []);
        }

        return new RunPromise(this.#connection, name, undefined, arg2 ?? []);
    }
}
