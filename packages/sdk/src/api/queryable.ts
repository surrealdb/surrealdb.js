import {
    type RecordId,
    type RecordIdRange,
    type RecordIdValue,
    Table,
    type Uuid,
} from "@surrealdb/sqon";
import type { ConnectionController } from "../controller";
import { composeQueries } from "../internal/compose-queries";
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
} from "../query";
import type { AnyRecordId, LiveResource, QueryLike, RecordResult, Session, Values } from "../types";
import { BoundQuery } from "../utils";
import { type DefaultPaths, SurrealApi } from "./api";

/**
 * Represents a scope capable of executing SurrealDB queries.
 */
export abstract class SurrealQueryable {
    readonly #connection: ConnectionController;
    readonly #transaction: Uuid | undefined;
    readonly #session: Session;
    readonly #signals: readonly AbortSignal[] | undefined;

    constructor(
        connection: ConnectionController,
        session: Session,
        transaction?: Uuid,
        signals?: readonly AbortSignal[],
    ) {
        this.#connection = connection;
        this.#session = session;
        this.#transaction = transaction;
        this.#signals = signals;
    }

    /**
     * Access user defined APIs defined on the database.
     *
     * Path types can be passed to this method in order to
     * provide type safety when invoking APIs.
     *
     * An optional prefix can be provided to prepend to API paths.
     *
     * @example
     * ```ts
     * type MyPaths = {
     *     "/users": { get: [void, User[]] };
     *     [K: `/users/${number}`]: { get: [void, User] };
     * };
     *
     * // Type-safe path and response
     * const api = db.api<MyPaths>();
     * api.get("/users"); // User[]
     *
     * // Prefix to invoke GET /users/:id
     * const usersApi = db.api<MyPaths>("/users");
     * api.get(userId); // User
     * ```
     *
     * @param prefix An optional path prefix to prepend to API paths.
     * @returns A new `SurrealApi` instance.
     */
    api<TPaths = DefaultPaths>(prefix?: string): SurrealApi<TPaths> {
        return new SurrealApi(
            this.#connection,
            this.#session,
            this.#transaction,
            prefix,
            this.#signals,
        );
    }

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
    query<R extends unknown[] = unknown[]>(
        query: string,
        bindings?: Record<string, unknown>,
    ): Query<R>;

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

    /**
     * Runs a list of queries together, in a single request.
     *
     * This is a **batch**, not a transaction: the queries are sent as if their statements
     * had been written one after another in a single query, and are **not** atomic. A failing
     * statement does not stop the ones after it, and whatever the others did stays done. To
     * run the queries atomically, use `transaction()`.
     *
     * Each input can be a string, a `BoundQuery` (such as one created with the `surql` template
     * tag), a query builder (such as `select()` or `create()`) or a `Query` returned by `query()`.
     *
     * Results are positional **per statement**, not per input. A string holding three
     * statements takes three slots, and shifts the position of the results which follow
     * it. A query builder always holds exactly one statement. Use `.responses()` to
     * see the outcome of each statement individually, including those which failed.
     *
     * Two inputs cannot bind the same parameter name. The `surql` template tag and query
     * builders generate unique names, so this only concerns hand written `BoundQuery`
     * instances.
     *
     * @example
     * ```ts
     * const [everyone, adults] = await db
     *     .query<[Person[], Person[]]>([
     *         db.select<Person>(new Table("person")),
     *         surql`SELECT * FROM person WHERE age >= ${18}`,
     *     ])
     *     .collect();
     * ```
     *
     * @param queries The queries to run, each of which can be a string, `BoundQuery`, query builder or `Query`
     * @returns A `Query` instance which can be used to execute or configure the query
     */
    query<R extends unknown[] = unknown[]>(queries: readonly QueryLike[]): Query<R>;

    // Shadow implementation
    query(
        query: string | BoundQuery | readonly QueryLike[],
        bindings?: Record<string, unknown>,
    ): Query {
        let bound: BoundQuery;

        if (Array.isArray(query)) {
            bound = composeQueries(query);
        } else if (query instanceof BoundQuery) {
            bound = query as unknown as BoundQuery;
        } else {
            bound = new BoundQuery(query as string, bindings);
        }

        return new Query(this.#connection, {
            query: bound,
            transaction: this.#transaction,
            session: this.#session,
            json: false,
            signals: this.#signals,
        });
    }

    /**
     * Runs an ISO GQL (ISO/IEC 39075) query against the database.
     *
     * GQL is the standardized graph query language. Unlike {@link query}, the
     * provided string is executed by the server's GQL engine rather than the
     * SurrealQL engine. The resulting `Query` instance behaves identically to a
     * SurrealQL query: await it (or use `.collect()`, `.stream()`, `.responses()`)
     * to process the results.
     *
     * A namespace and database must be selected before running a GQL query.
     *
     * @example
     * ```ts
     * const [people] = await db.gql("MATCH (p:person) RETURN p.name AS name");
     * ```
     *
     * @param query The GQL query string
     * @param bindings Assigns variables which can be referenced in the query
     * @returns A `Query` instance which can be used to execute or configure the query
     */
    gql<R extends unknown[] = unknown[]>(
        query: string,
        bindings?: Record<string, unknown>,
    ): Query<R> {
        return new Query(this.#connection, {
            query: new BoundQuery(query, bindings),
            transaction: this.#transaction,
            session: this.#session,
            json: false,
            dialect: "gql",
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
            transaction: this.#transaction,
            session: this.#session,
            json: false,
            signals: this.#signals,
        });
    }

    /**
     * Create a new managed live query subscription to a table, record ID, or record ID range.
     *
     * Unlike `liveOf()`, which attaches to an already existing live query UUID, `live()` automatically
     * registers the `LIVE SELECT` statement on SurrealDB, tracks the live query UUID, and transparently
     * handles re-establishing the subscription across connection drops.
     *
     * When called on a view made with `withSignal()`, the subscription is killed when the signal
     * aborts: iteration ends, `isAlive` turns false, and the live query is killed on the server.
     * See `SurrealRequestScope`.
     *
     * @see {@link liveOf} for attaching an unmanaged subscriber to an existing live query ID.
     * @param what The table, record ID, or record ID range to subscribe to
     * @returns A new managed live subscription object
     */
    live<T = Record<string, unknown>>(what: LiveResource): ManagedLivePromise<T> {
        return new ManagedLivePromise(this.#connection, {
            what,
            session: this.#session,
            signals: this.#signals,
        });
    }

    /**
     * Manually subscribe to an existing live query using its UUID.
     *
     * **NOTE:** This function is for use with live queries that are not managed by the driver,
     * such as those created directly via raw SurrealQL (`db.query("LIVE SELECT ...")`) or an
     * external service. Unlike `live()`, this does not create the live query on the database or
     * re-establish it on reconnection.
     *
     * When called on a view made with `withSignal()`, the live query is killed on the server when the
     * signal aborts, as `kill()` would, and a signal which has aborted already subscribes to nothing.
     *
     * @see {@link live} for automatic, driver-managed live queries with reconnect support.
     * @param id The UUID of the existing live query to subscribe to
     * @returns A new unmanaged live subscription object
     */
    liveOf(id: Uuid): UnmanagedLivePromise {
        return new UnmanagedLivePromise(this.#connection, {
            id,
            session: this.#session,
            signals: this.#signals,
        });
    }

    /**
     * Select the contents of a specific record based on the provied Record ID
     *
     * @param recordId The record ID to select
     */
    select<T = unknown>(
        recordId: RecordId<string, RecordIdValue, T>,
    ): SelectPromise<RecordResult<T> | undefined, T>;

    /**
     * Same as above, with the record type given explicitly, e.g. `db.select<User>(recordId)`.
     * Use this for record IDs that were not created from a table with a record type.
     */
    select<T>(recordId: AnyRecordId): SelectPromise<RecordResult<T> | undefined, T>;

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
    select<T = unknown>(table: Table<string, T>): SelectPromise<RecordResult<T>[], T>;

    /**
     * Same as above, with the record type given explicitly, e.g. `db.select<User>(new Table("users"))`.
     * Use this for tables that were not declared with a record type.
     */
    select<T>(table: Table): SelectPromise<RecordResult<T>[], T>;

    // Shadow implementation
    select(what: AnyRecordId | RecordIdRange | Table): unknown {
        return new SelectPromise(this.#connection, {
            what,
            transaction: this.#transaction,
            session: this.#session,
            json: false,
            signals: this.#signals,
        });
    }

    /**
     * Create a new record in the database using the SurrealQL `CREATE` statement.
     *
     * Use `create()` when creating a single record (with a specific `RecordId` or generated ID
     * in a `Table`) where you want to chain mutation methods like `.content()`, `.set()`, `.merge()`,
     * or `.patch()`. If a record with the specified ID already exists, the operation fails.
     *
     * For bulk inserting multiple records, or when you want to ignore duplicate conflicts with
     * `.ignore()`, use `insert()` instead.
     *
     * @see {@link insert} for bulk insertion or `INSERT IGNORE` support.
     * @param recordId The record ID of the record to create
     */
    create<T = unknown>(
        recordId: RecordId<string, RecordIdValue, T>,
    ): CreatePromise<RecordResult<T>, T>;

    /**
     * Same as above, with the record type given explicitly, e.g. `db.create<User>(recordId)`.
     * Use this for record IDs that were not created from a table with a record type.
     */
    create<T>(recordId: AnyRecordId): CreatePromise<RecordResult<T>, T>;

    /**
     * Create a new record in the specified table using the SurrealQL `CREATE` statement.
     *
     * Use `create()` when creating a single record (with a specific `RecordId` or generated ID
     * in a `Table`) where you want to chain mutation methods like `.content()`, `.set()`, `.merge()`,
     * or `.patch()`. If a record with the specified ID already exists, the operation fails.
     *
     * For bulk inserting multiple records, or when you want to ignore duplicate conflicts with
     * `.ignore()`, use `insert()` instead.
     *
     * @see {@link insert} for bulk insertion or `INSERT IGNORE` support.
     * @param table The table to create a record in
     */
    create<T = unknown>(table: Table<string, T>): CreatePromise<RecordResult<T>[], T>;

    /**
     * Same as above, with the record type given explicitly, e.g. `db.create<User>(new Table("users"))`.
     * Use this for tables that were not declared with a record type.
     */
    create<T>(table: Table): CreatePromise<RecordResult<T>[], T>;

    // Shadow implementation
    create(what: AnyRecordId | Table): unknown {
        return new CreatePromise(this.#connection, {
            what,
            transaction: this.#transaction,
            session: this.#session,
            json: false,
            signals: this.#signals,
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
            transaction: this.#transaction,
            session: this.#session,
            json: false,
            signals: this.#signals,
        });
    }

    /**
     * Inserts one or multiple records into the database using the SurrealQL `INSERT` statement.
     *
     * Use `insert()` when:
     * - Ingesting records in bulk (`Values<T>[]`).
     * - Inserting records that already specify their own `id` field.
     * - You want to ignore conflicts on existing records using `.ignore()` (`INSERT IGNORE`).
     * - You want to insert graph relation records using `.relation()` (`INSERT RELATION`).
     *
     * Note: Unlike `create()`, `insert()` expects record data payloads as its argument (optionally
     * preceded by a target `Table`), rather than taking a `RecordId` as a target. To create a
     * record at a specific `RecordId`, use `db.create(recordId).content(data)`.
     *
     * @see {@link create} for creating a single record with mutation builders (`.content()`, `.set()`, `.patch()`).
     * @param data One or more records to insert
     */
    insert<T>(data: Values<T> | Values<T>[]): InsertPromise<RecordResult<T>[]>;

    /**
     * Inserts one or multiple records into the database using the SurrealQL `INSERT` statement.
     *
     * Use `insert()` when:
     * - Ingesting records in bulk (`Values<T>[]`).
     * - Inserting records that already specify their own `id` field.
     * - You want to ignore conflicts on existing records using `.ignore()` (`INSERT IGNORE`).
     * - You want to insert graph relation records using `.relation()` (`INSERT RELATION`).
     *
     * Note: Unlike `create()`, `insert()` expects record data payloads as its argument (optionally
     * preceded by a target `Table`), rather than taking a `RecordId` as a target. To create a
     * record at a specific `RecordId`, use `db.create(recordId).content(data)`.
     *
     * @see {@link create} for creating a single record with mutation builders (`.content()`, `.set()`, `.patch()`).
     * @param table The table to insert the record into
     * @param data One or more records to insert
     */
    insert<T = unknown>(
        table: Table<string, T>,
        data: Values<T> | Values<T>[],
    ): InsertPromise<RecordResult<T>[]>;

    /**
     * Same as above, with the record type given explicitly, e.g. `db.insert<User>(new Table("users"), data)`.
     * Use this for tables that were not declared with a record type.
     */
    insert<T>(table: Table, data: Values<T> | Values<T>[]): InsertPromise<RecordResult<T>[]>;

    // Shadow implementation
    insert<T>(arg1: Table | Values<T> | Values<T>[], arg2?: Values<T> | Values<T>[]): unknown {
        if (arg1 instanceof Table) {
            return new InsertPromise(this.#connection, {
                table: arg1 as unknown as Table,
                what: arg2 ?? [],
                transaction: this.#transaction,
                session: this.#session,
                json: false,
                signals: this.#signals,
            });
        }

        return new InsertPromise(this.#connection, {
            table: undefined,
            what: arg1,
            transaction: this.#transaction,
            session: this.#session,
            json: false,
            signals: this.#signals,
        });
    }

    /**
     * Updates a single record based on the provided Record ID
     *
     * @param recordId The record ID to update
     */
    update<T = unknown>(
        recordId: RecordId<string, RecordIdValue, T>,
    ): UpdatePromise<RecordResult<T>, T>;

    /**
     * Same as above, with the record type given explicitly, e.g. `db.update<User>(recordId)`.
     * Use this for record IDs that were not created from a table with a record type.
     */
    update<T>(recordId: AnyRecordId): UpdatePromise<RecordResult<T>, T>;

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
    update<T = unknown>(table: Table<string, T>): UpdatePromise<RecordResult<T>[], T>;

    /**
     * Same as above, with the record type given explicitly, e.g. `db.update<User>(new Table("users"))`.
     * Use this for tables that were not declared with a record type.
     */
    update<T>(table: Table): UpdatePromise<RecordResult<T>[], T>;

    // Shadow implementation
    update(what: AnyRecordId | RecordIdRange | Table): unknown {
        return new UpdatePromise(this.#connection, {
            what,
            transaction: this.#transaction,
            session: this.#session,
            json: false,
            signals: this.#signals,
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
    upsert<T = unknown>(
        recordId: RecordId<string, RecordIdValue, T>,
    ): UpsertPromise<RecordResult<T>, T>;

    /**
     * Same as above, with the record type given explicitly, e.g. `db.upsert<User>(recordId)`.
     * Use this for record IDs that were not created from a table with a record type.
     */
    upsert<T>(recordId: AnyRecordId): UpsertPromise<RecordResult<T>, T>;

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
    upsert<T = unknown>(table: Table<string, T>): UpsertPromise<RecordResult<T>[], T>;

    /**
     * Same as above, with the record type given explicitly, e.g. `db.upsert<User>(new Table("users"))`.
     * Use this for tables that were not declared with a record type.
     */
    upsert<T>(table: Table): UpsertPromise<RecordResult<T>[], T>;

    // Shadow implementation
    upsert(what: AnyRecordId | RecordIdRange | Table): unknown {
        return new UpsertPromise(this.#connection, {
            what,
            transaction: this.#transaction,
            session: this.#session,
            json: false,
            signals: this.#signals,
        });
    }

    /**
     * Deletes a single record from the database based on the provided Record ID
     *
     * @param recordId The record ID to delete
     */
    delete<T = unknown>(
        recordId: RecordId<string, RecordIdValue, T>,
    ): DeletePromise<RecordResult<T>>;

    /**
     * Same as above, with the record type given explicitly, e.g. `db.delete<User>(recordId)`.
     * Use this for record IDs that were not created from a table with a record type.
     */
    delete<T>(recordId: AnyRecordId): DeletePromise<RecordResult<T>>;

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
    delete<T = unknown>(table: Table<string, T>): DeletePromise<RecordResult<T>[]>;

    /**
     * Same as above, with the record type given explicitly, e.g. `db.delete<User>(new Table("users"))`.
     * Use this for tables that were not declared with a record type.
     */
    delete<T>(table: Table): DeletePromise<RecordResult<T>[]>;

    // Shadow implementation
    delete(what: AnyRecordId | RecordIdRange | Table): unknown {
        return new DeletePromise(this.#connection, {
            what,
            output: "before",
            transaction: this.#transaction,
            session: this.#session,
            json: false,
            signals: this.#signals,
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
                transaction: this.#transaction,
                session: this.#session,
                json: false,
                signals: this.#signals,
            });
        }

        return new RunPromise(this.#connection, {
            name,
            version: undefined,
            args: arg2 ?? [],
            transaction: this.#transaction,
            session: this.#session,
            json: false,
            signals: this.#signals,
        });
    }
}
