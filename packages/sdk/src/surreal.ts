import type { Fill } from "@surrealdb/cbor";
import { decodeCbor, encodeCbor } from "./cbor";
import { ConnectionController } from "./controller";
import { parseEndpoint } from "./internal/http";
import {
	AuthenticatePromise,
	CreatePromise,
	DeletePromise,
	InfoPromise,
	InsertPromise,
	InsertRelationPromise,
	InvalidatePromise,
	LetPromise,
	ManagedLivePromise,
	MergePromise,
	PatchPromise,
	QueryPromise,
	RelatePromise,
	RunPromise,
	SelectPromise,
	SigninPromise,
	SignupPromise,
	UnmanagedLivePromise,
	UnsetPromise,
	UpdatePromise,
	UpsertPromise,
	UsePromise,
	VersionPromise,
} from "./query";
import type {
	AccessRecordAuth,
	AnyAuth,
	ConnectionStatus,
	ConnectOptions,
	Doc,
	DriverOptions,
	EventPublisher,
	ExportOptions,
	LiveResource,
	Patch,
	RecordResult,
	RelateInOut,
	Token,
} from "./types";
import type { PreparedQuery } from "./utils";
import { Publisher } from "./utils/publisher";
import type { RecordId, RecordIdRange, Table, Uuid } from "./value";

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
	health(): void {
		// TODO Implement
	}

	/**
	 * Retrieves the version of the connected SurrealDB instance
	 *
	 * @example `surrealdb-2.1.0`
	 */
	version(): VersionPromise {
		return new VersionPromise(this.#connection);
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
	 * @return The authentication token.
	 */
	signup(auth: AccessRecordAuth): SignupPromise {
		return new SignupPromise(this.#connection, auth);
	}

	/**
	 * Authenticate with the SurrealDB using the provided authentication details.
	 *
	 * @param auth The authentication details to use.
	 * @return The authentication token.
	 */
	signin(auth: AnyAuth): SigninPromise {
		return new SigninPromise(this.#connection, auth);
	}

	/**
	 * Authenticates the current connection with a JWT token.
	 *
	 * @param token The JWT authentication token.
	 */
	authenticate(token: Token): AuthenticatePromise {
		return new AuthenticatePromise(this.#connection, token);
	}

	/**
	 * Switch to the specified {@link https://surrealdb.com/docs/surrealdb/introduction/concepts/namespace|namespace}
	 * and {@link https://surrealdb.com/docs/surrealdb/introduction/concepts/database|database}
	 *
	 * @param database Switches to a specific namespace
	 * @param db Switches to a specific database
	 */
	use({
		namespace,
		database,
	}: {
		namespace?: string | null;
		database?: string | null;
	}): UsePromise {
		return new UsePromise(this.#connection, namespace, database);
	}

	/**
	 * Define a global variable for the current socket connection
	 *
	 * @param key Specifies the name of the variable
	 * @param val Assigns the value to the variable name
	 */
	set(variable: string, value: unknown): LetPromise {
		return new LetPromise(this.#connection, variable, value);
	}

	/**
	 * Remove a variable from the current socket connection
	 *
	 * @param key Specifies the name of the variable.
	 */
	unset(variable: string): UnsetPromise {
		return new UnsetPromise(this.#connection, variable);
	}

	/**
	 * Invalidates the authentication for the current connection.
	 */
	invalidate(): InvalidatePromise {
		return new InvalidatePromise(this.#connection);
	}

	/**
	 * Resets the current session to its initial state, clearing
	 * authentication state, variables, and selected namespace/database.
	 */
	reset(): void {
		// TODO Implement
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
	public async export(options?: Partial<ExportOptions>): Promise<string> {
		await this.ready;
		return this.#connection.export(options);
	}

	/**
	 * Import an existing export into the database
	 *
	 * @param input The data to import
	 */
	public async import(input: string): Promise<void> {
		await this.ready;
		return this.#connection.import(input);
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
	query<T extends unknown[]>(query: string, bindings?: Record<string, unknown>): QueryPromise<T>;

	/**
	 * Runs a set of SurrealQL statements against the database, returning the first error
	 * if any of the statements result in an error
	 *
	 * @param prepared Specifies the prepared query to run
	 * @param gaps Assigns values to gaps present in the prepared query
	 */
	query<T extends unknown[]>(prepared: PreparedQuery, gaps?: Fill[]): QueryPromise<T>;

	// Shadow implementation
	query<T extends unknown[]>(
		preparedOrQuery: string | PreparedQuery,
		gapsOrBinds?: Record<string, unknown> | Fill[],
	): QueryPromise<T> {
		return new QueryPromise(this.#connection, preparedOrQuery, gapsOrBinds);
	}

	/**
	 * Selects everything from the [$auth](https://surrealdb.com/docs/surrealql/parameters) variable.
	 *
	 * This is equivalent to running:
	 * ```sql
	 * SELECT * FROM $auth;
	 * ```
	 * Make sure the user actually has the permission to select their own record, otherwise you'll get back an empty result
	 *
	 * @return The record linked to the record ID used for authentication
	 */
	info<T extends Doc>(): InfoPromise<RecordResult<T> | undefined> {
		return new InfoPromise(this.#connection);
	}

	/**
	 * Create a new live subscription to a specific table, record id, or record id range
	 *
	 * @param what The table, record id, or record id range to subscribe to
	 * @returns A new live subscription object
	 */
	live(what: LiveResource): ManagedLivePromise {
		return new ManagedLivePromise(this.#connection, this.#publisher, what);
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
		return new InsertPromise(this.#connection, arg1, arg2);
	}

	/**
	 * Inserts one or multiple relations in the database
	 *
	 * @param data One or more relations to insert
	 */
	insertRelation<T extends Doc, U extends Doc = T>(
		data?: U | U[],
	): InsertRelationPromise<RecordResult<T>[], U>;

	/**
	 * Inserts one or multiple relations in the database
	 *
	 * @param table The table to insert the relation into
	 * @param data One or more relations to insert
	 */
	insertRelation<T extends Doc, U extends Doc = T>(
		table: Table,
		data?: U | U[],
	): InsertRelationPromise<RecordResult<T>[], U>;

	// Shadow implementation
	insertRelation<T extends Doc, U extends Doc = T>(
		arg1: Table | U | U[],
		arg2?: U | U[],
	): unknown {
		return new InsertRelationPromise(this.#connection, arg1, arg2);
	}

	/**
	 * Updates a single record based on the provided Record ID
	 *
	 * ***NOTE: This function replaces the existing record data with the specified data***
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
	 * ***NOTE: This function replaces the existing record data with the specified data***
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
	 * ***NOTE: This function replaces the existing record data with the specified data***
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
	 * ***NOTE: This function replaces the existing record data with the specified data**
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
	 * ***NOTE: This function replaces the existing record data with the specified data**
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
	 * ***NOTE: This function replaces the existing record data with the specified data**
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
	 * Merges a single record based on the provided Record ID
	 *
	 * @param recordId The record ID to merge
	 * @param data The record data to merge
	 */
	merge<T extends Doc, U extends Doc = Partial<T>>(
		thing: RecordId,
		data?: U,
	): MergePromise<RecordResult<T>, U>;

	/**
	 * Merges all records based on the provided Record ID range
	 *
	 * @param range The range of record IDs to merge
	 * @param data The record data to merge
	 */
	merge<T extends Doc, U extends Doc = Partial<T>>(
		thing: RecordIdRange,
		data?: U,
	): MergePromise<RecordResult<T>[], U>;

	/**
	 * Merges all records present in the specified table
	 *
	 * @param table The table to merge
	 * @param data The record data to merge
	 */
	merge<T extends Doc, U extends Doc = Partial<T>>(
		thing: Table,
		data?: U,
	): MergePromise<RecordResult<T>[], U>;

	// Shadow implementation
	merge<T extends Doc, U extends Doc = Partial<T>>(
		thing: RecordId | RecordIdRange | Table,
		data?: U,
	): unknown {
		return new MergePromise(this.#connection, thing, data);
	}

	/**
	 * Applies JSON Patch changes to all records, or a specific record, in the database
	 *
	 * ***NOTE: This function patches the existing record data with the specified JSON Patch operations***
	 *
	 * @param what The table name, record ID range, or specifc record ID to patch
	 * @param data The JSON Patch operations to apply
	 */
	patch<T extends Doc>(
		what: RecordId,
		data?: Patch[],
		diff?: false,
	): PatchPromise<RecordResult<T>>;
	patch<T extends Doc>(
		what: RecordIdRange | Table,
		data?: Patch[],
		diff?: false,
	): PatchPromise<RecordResult<T>[]>;
	patch(what: RecordId, data: undefined | Patch[], diff: true): PatchPromise<Patch[]>;
	patch(
		what: RecordIdRange | Table,
		data: undefined | Patch[],
		diff: true,
	): PatchPromise<Patch[][]>;

	// Shadow implementation
	patch(what: RecordId | RecordIdRange | Table, data?: Patch[], diff?: boolean): unknown {
		return new PatchPromise(this.#connection, what, data, diff);
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
	run<T>(name: string, version: string, args?: unknown[]): RunPromise<T>;

	// Shadow implementation
	run(name: string, arg2?: string | unknown[], arg3?: unknown[]): unknown {
		return new RunPromise(this.#connection, name, arg2, arg3);
	}
}
