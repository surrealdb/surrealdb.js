import type {
	AccessRecordAuth,
	ActionResult,
	AnyAuth,
	ConnectOptions,
	ConnectionStatus,
	Doc,
	DriverOptions,
	EventPublisher,
	ExportOptions,
	LiveResource,
	Patch,
	Prettify,
	RelateInOut,
	RpcResponse,
	Token,
} from "../types";

import {
	type LiveSubscription,
	ManagedLiveSubscription,
	UnmanagedLiveSubscription,
} from "../utils/live";

import { type Fill, partiallyEncodeObject } from "@surrealdb/cbor";
import { decodeCbor, encodeCbor } from "../cbor";
import { REPLACER } from "../cbor/replacer";
import { ConnectionController } from "../controller";
import { NoTokenReturned, ResponseError, SurrealError } from "../errors";
import { parseEndpoint } from "../internal/http";
import { output } from "../internal/output";
import type { MapQueryResult } from "../types/query";
import { PreparedQuery } from "../utils";
import { Publisher } from "../utils/publisher";
import { type RecordId, type RecordIdRange, Table, type Uuid } from "../value";

export type SurrealV1Events = {
	connecting: [];
	connected: [];
	reconnecting: [];
	disconnected: [];
	error: [Error];
	authenticated: [Token];
	invalidated: [];
};

/**
 * An interface for communicating to SurrealDB over the v1 RPC protocol
 */
export class SurrealV1 implements EventPublisher<SurrealV1Events> {
	readonly #publisher = new Publisher<SurrealV1Events>();
	readonly #connection: ConnectionController;

	subscribe<K extends keyof SurrealV1Events>(
		event: K,
		listener: (...payload: SurrealV1Events[K]) => void,
	): () => void {
		return this.#publisher.subscribe(event, listener);
	}

	constructor(options: DriverOptions = {}) {
		this.#connection = new ConnectionController({
			options,
			encode: encodeCbor,
			decode: decodeCbor,
		});

		this.#connection.subscribe("connecting", () =>
			this.#publisher.publish("connecting"),
		);

		this.#connection.subscribe("connected", () =>
			this.#publisher.publish("connected"),
		);

		this.#connection.subscribe("disconnected", () =>
			this.#publisher.publish("disconnected"),
		);

		this.#connection.subscribe("reconnecting", () =>
			this.#publisher.publish("reconnecting"),
		);

		this.#connection.subscribe("error", (error) =>
			this.#publisher.publish("error", error),
		);

		this.#connection.subscribe("authenticated", (token) =>
			this.#publisher.publish("authenticated", token),
		);

		this.#connection.subscribe("invalidated", () =>
			this.#publisher.publish("invalidated"),
		);
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

	/**
	 * Send a raw RPC message to the SurrealDB instance
	 *
	 * @param method Type of message to send
	 * @param params Optional parameters for the message
	 */
	public rpc<Result>(
		method: string,
		params?: unknown[],
	): Promise<RpcResponse<Result>> {
		return this.#connection.rpc({
			method,
			params,
		});
	}

	/**
	 * Ping the connected SurrealDB instance
	 */
	async ping(): Promise<true> {
		const { error } = await this.rpc("ping");
		if (error) throw new ResponseError(error.message);
		return true;
	}

	/**
	 * Switch to the specified {@link https://surrealdb.com/docs/surrealdb/introduction/concepts/namespace|namespace}
	 * and {@link https://surrealdb.com/docs/surrealdb/introduction/concepts/database|database}
	 *
	 * @param database Switches to a specific namespace
	 * @param db Switches to a specific database
	 */
	async use({
		namespace,
		database,
	}: {
		namespace?: string | null;
		database?: string | null;
	}): Promise<true> {
		await this.ready;

		if (namespace === null && database !== null)
			throw new SurrealError(
				"Cannot unset namespace without unsetting database",
			);

		const { error } = await this.rpc("use", [namespace, database]);
		if (error) throw new ResponseError(error.message);
		return true;
	}

	/**
	 * Sign up to the SurrealDB instance as a new
	 * {@link https://surrealdb.com/docs/surrealdb/security/authentication#record-users|record user}.
	 *
	 * @param auth The authentication details to use.
	 * @return The authentication token.
	 */
	async signup(auth: AccessRecordAuth): Promise<Token> {
		await this.ready;

		const converted = this.#connection.buildAuth(auth);
		const res = await this.rpc<Token>("signup", [converted]);

		if (res.error) throw new ResponseError(res.error.message);
		if (!res.result) throw new NoTokenReturned();

		return res.result;
	}

	/**
	 * Authenticate with the SurrealDB using the provided authentication details.
	 *
	 * @param auth The authentication details to use.
	 * @return The authentication token.
	 */
	async signin(auth: AnyAuth): Promise<Token> {
		await this.ready;

		const converted = this.#connection.buildAuth(auth);
		const res = await this.rpc<Token>("signin", [converted]);

		if (res.error) throw new ResponseError(res.error.message);
		if (!res.result) throw new NoTokenReturned();

		return res.result;
	}

	/**
	 * Authenticates the current connection with a JWT token.
	 *
	 * @param token The JWT authentication token.
	 */
	async authenticate(token: Token): Promise<true> {
		await this.ready;
		const res = await this.rpc<string>("authenticate", [token]);
		if (res.error) throw new ResponseError(res.error.message);
		return true;
	}

	/**
	 * Invalidates the authentication for the current connection.
	 */
	async invalidate(): Promise<true> {
		await this.ready;
		const res = await this.rpc("invalidate");
		if (res.error) throw new ResponseError(res.error.message);
		return true;
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
	async info<T extends Doc>(): Promise<ActionResult<T> | undefined> {
		await this.ready;
		const res = await this.rpc<ActionResult<T> | undefined>("info");
		if (res.error) throw new ResponseError(res.error.message);
		return res.result ?? undefined;
	}

	/**
	 * Specify a variable for the current socket connection
	 *
	 * @param key Specifies the name of the variable
	 * @param val Assigns the value to the variable name
	 */
	async let(variable: string, value: unknown): Promise<true> {
		await this.ready;
		const res = await this.rpc("let", [variable, value]);
		if (res.error) throw new ResponseError(res.error.message);
		return true;
	}

	/**
	 * Remove a variable from the current socket connection
	 *
	 * @param key Specifies the name of the variable.
	 */
	async unset(variable: string): Promise<true> {
		await this.ready;
		const res = await this.rpc("unset", [variable]);
		if (res.error) throw new ResponseError(res.error.message);
		return true;
	}

	/**
	 * Create a new live subscription to a specific table, record id, or record id range
	 *
	 * @param what The table, record id, or record id range to subscribe to
	 * @returns A new live subscription object
	 */
	async live(what: LiveResource, diff?: boolean): Promise<LiveSubscription> {
		await this.ready;
		return new ManagedLiveSubscription(
			this.#publisher,
			this.#connection,
			what,
			diff ?? false,
		);
	}

	/**
	 * Manually subscribe to an existing live subscription using the provided ID
	 *
	 * **NOTE:** This function is for use with live select queries that are not managed by the driver.
	 *
	 * @param id The ID of the live subscription to subscribe to
	 * @returns A new unmanaged live subscription object
	 */
	async liveOf(id: Uuid): Promise<LiveSubscription> {
		await this.ready;
		return new UnmanagedLiveSubscription(this.#connection, id);
	}

	/**
	 * Runs a set of SurrealQL statements against the database, returning the first error
	 * if any of the statements result in an error
	 *
	 * @param query Specifies the SurrealQL statements
	 * @param bindings Assigns variables which can be used in the query
	 */
	async query<T extends unknown[]>(
		query: string,
		bindings?: Record<string, unknown>,
	): Promise<Prettify<T>>;

	/**
	 * Runs a set of SurrealQL statements against the database, returning the first error
	 * if any of the statements result in an error
	 *
	 * @param prepared Specifies the prepared query to run
	 * @param gaps Assigns values to gaps present in the prepared query
	 */
	async query<T extends unknown[]>(
		prepared: PreparedQuery,
		gaps?: Fill[],
	): Promise<Prettify<T>>;

	// Shadow implementation
	async query<T extends unknown[]>(
		preparedOrQuery: string | PreparedQuery,
		gapsOrBinds?: Record<string, unknown> | Fill[],
	): Promise<Prettify<T>> {
		const response = await this.#queryImpl<T>(preparedOrQuery, gapsOrBinds);

		return response.map(({ status, result }) => {
			if (status === "ERR") throw new ResponseError(result);
			return result;
		}) as T;
	}

	/**
	 * Runs a set of SurrealQL statements against the database
	 *
	 * @param query Specifies the SurrealQL statements
	 * @param bindings Assigns variables which can be used in the query
	 */
	async queryRaw<T extends unknown[]>(
		query: string,
		bindings?: Record<string, unknown>,
	): Promise<Prettify<MapQueryResult<T>>>;

	/**
	 * Runs a set of SurrealQL statements against the database
	 *
	 * @param prepared Specifies the prepared query to run
	 * @param gaps Assigns values to gaps present in the prepared query
	 */
	async queryRaw<T extends unknown[]>(
		prepared: PreparedQuery,
		gaps?: Fill[],
	): Promise<Prettify<MapQueryResult<T>>>;

	// Shadow implementation
	async queryRaw<T extends unknown[]>(
		preparedOrQuery: string | PreparedQuery,
		gapsOrBinds?: Record<string, unknown> | Fill[],
	): Promise<Prettify<MapQueryResult<T>>> {
		return this.#queryImpl(preparedOrQuery, gapsOrBinds);
	}

	// Internal implementation
	async #queryImpl<T extends unknown[]>(
		preparedOrQuery: string | PreparedQuery,
		gapsOrBinds?: Record<string, unknown> | Fill[],
	) {
		await this.ready;

		let params: unknown[];

		if (preparedOrQuery instanceof PreparedQuery) {
			params = [
				preparedOrQuery.query,
				partiallyEncodeObject(preparedOrQuery.bindings, {
					fills: gapsOrBinds as Fill[],
					replacer: REPLACER.encode,
				}),
			];
		} else {
			params = [preparedOrQuery, gapsOrBinds];
		}

		const res = await this.rpc<MapQueryResult<T>>("query", params);
		if (res.error) throw new ResponseError(res.error.message);
		return res.result;
	}

	/**
	 * Select all fields from a specific record based on the provied Record ID
	 *
	 * @param recordId The record ID to select
	 */
	async select<T extends Doc>(recordId: RecordId): Promise<ActionResult<T>>;

	/**
	 * Select all records based on the provided Record ID range
	 *
	 * @param range The range of record IDs to select
	 */
	async select<T extends Doc>(range: RecordIdRange): Promise<ActionResult<T>[]>;

	/**
	 * Select all records present in the specified table
	 *
	 * @param recordId The record ID to select
	 */
	async select<T extends Doc>(table: Table): Promise<ActionResult<T>[]>;

	// Shadow implementation
	async select<T extends Doc>(what: RecordId | RecordIdRange | Table) {
		await this.ready;
		const res = await this.rpc<ActionResult<T>>("select", [what]);
		if (res.error) throw new ResponseError(res.error.message);
		return output(what, res.result);
	}

	/**
	 * Create a new record in the database
	 *
	 * @param recordId The record id of the record to create
	 * @param data The record data to insert
	 */
	async create<T extends Doc, U extends Doc = T>(
		recordId: RecordId,
		data?: U,
	): Promise<ActionResult<T>>;

	/**
	 * Create a new record in the specified table
	 *
	 * @param table The table to create a record in
	 * @param data The record data to insert
	 */
	async create<T extends Doc, U extends Doc = T>(
		table: Table,
		data?: U,
	): Promise<ActionResult<T>[]>;

	// Shadow implementation
	async create<T extends Doc, U extends Doc = T>(
		what: RecordId | Table,
		data?: U,
	) {
		await this.ready;
		const res = await this.rpc<ActionResult<T>>("create", [what, data]);
		if (res.error) throw new ResponseError(res.error.message);
		return output(what, res.result);
	}

	/**
	 * Create a graph edge between the from record(s) and the to record(s) using a specific edge record id
	 *
	 * @param from The in property on the edge record
	 * @param edge The id of the edge record
	 * @param to  The out property on the edge record
	 * @param data The optional record data to store on the edge
	 */
	async relate<T extends Doc, U extends Doc = T>(
		from: RelateInOut,
		edge: RecordId,
		to: RelateInOut,
		data?: U,
	): Promise<T>;

	/**
	 * Create a graph edge between the from record(s) and the to record(s) on the specified edge table
	 *
	 * @param from The in property on the edge record
	 * @param edge The edge table to create the relation in
	 * @param to  The out property on the edge record
	 * @param data The optional record data to store on the edge
	 */
	async relate<T extends Doc, U extends Doc = T>(
		from: RelateInOut,
		edge: Table,
		to: RelateInOut,
		data?: U,
	): Promise<T[]>;

	// Shadow implementation
	async relate<T extends Doc, U extends Doc = T>(
		from: RelateInOut,
		thing: Table | RecordId,
		to: RelateInOut,
		data?: U,
	) {
		await this.ready;
		const res = await this.rpc("relate", [from, thing, to, data]);
		if (res.error) throw new ResponseError(res.error.message);
		return output(thing, res.result);
	}

	/**
	 * Inserts one or multiple records into the database
	 *
	 * @param data One or more records to insert
	 */
	async insert<T extends Doc, U extends Doc = T>(
		data?: U | U[],
	): Promise<ActionResult<T>[]>;

	/**
	 * Inserts one or multiple records into the database
	 *
	 * @param table The table to insert the record into
	 * @param data One or more records to insert
	 */
	async insert<T extends Doc, U extends Doc = T>(
		table: Table,
		data?: U | U[],
	): Promise<ActionResult<T>[]>;

	// Shadow implementation
	async insert<T extends Doc, U extends Doc = T>(
		arg1: Table | U | U[],
		arg2?: U | U[],
	) {
		await this.ready;
		const params = arg1 instanceof Table ? [arg1, arg2] : [undefined, arg1];
		const res = await this.rpc<ActionResult<T>>("insert", params);
		if (res.error) throw new ResponseError(res.error.message);
		return res.result;
	}

	/**
	 * Inserts one or multiple relations in the database
	 *
	 * @param data One or more relations to insert
	 */
	async insertRelation<T extends Doc, U extends Doc = T>(
		data?: U | U[],
	): Promise<ActionResult<T>[]>;

	/**
	 * Inserts one or multiple relations in the database
	 *
	 * @param table The table to insert the relation into
	 * @param data One or more relations to insert
	 */
	async insertRelation<T extends Doc, U extends Doc = T>(
		table: Table,
		data?: U | U[],
	): Promise<ActionResult<T>[]>;

	// Shadow implementation
	async insertRelation<T extends Doc, U extends Doc = T>(
		arg1: Table | U | U[],
		arg2?: U | U[],
	) {
		await this.ready;
		const params = arg1 instanceof Table ? [arg1, arg2] : [undefined, arg1];
		const res = await this.rpc<ActionResult<T>>("insert_relation", params);
		if (res.error) throw new ResponseError(res.error.message);
		return res.result;
	}

	/**
	 * Updates a single record based on the provided Record ID
	 *
	 * ***NOTE: This function replaces the existing record data with the specified data***
	 *
	 * @param recordId The record ID to update
	 * @param data The record data to update
	 */
	async update<T extends Doc, U extends Doc = T>(
		recordId: RecordId,
		data?: U,
	): Promise<ActionResult<T>>;

	/**
	 * Updates all records based on the provided Record ID range
	 *
	 * ***NOTE: This function replaces the existing record data with the specified data***
	 *
	 * @param range The range of record IDs to update
	 * @param data The record data to update
	 */
	async update<T extends Doc, U extends Doc = T>(
		range: RecordIdRange,
		data?: U,
	): Promise<ActionResult<T>[]>;

	/**
	 * Updates all records present in the specified table
	 *
	 * ***NOTE: This function replaces the existing record data with the specified data***
	 *
	 * @param table The table to update
	 * @param data The record data to update
	 */
	async update<T extends Doc, U extends Doc = T>(
		range: Table,
		data?: U,
	): Promise<ActionResult<T>[]>;

	// Shadow implementation
	async update<T extends Doc, U extends Doc = T>(
		thing: RecordId | RecordIdRange | Table,
		data?: U,
	) {
		await this.ready;
		const res = await this.rpc<ActionResult<T>>("update", [thing, data]);
		if (res.error) throw new ResponseError(res.error.message);
		return output(thing, res.result);
	}

	/**
	 * Upserts a single record based on the provided Record ID
	 *
	 * ***NOTE: This function replaces the existing record data with the specified data**
	 *
	 * @param recordId The record ID to upsert
	 * @param data The record data to upsert
	 */
	async upsert<T extends Doc, U extends Doc = T>(
		recordId: RecordId,
		data?: U,
	): Promise<ActionResult<T>>;

	/**
	 * Upserts all records based on the provided Record ID range
	 *
	 * ***NOTE: This function replaces the existing record data with the specified data**
	 *
	 * @param range The range of record IDs to upsert
	 * @param data The record data to upsert
	 */
	async upsert<T extends Doc, U extends Doc = T>(
		thing: RecordIdRange,
		data?: U,
	): Promise<ActionResult<T>[]>;

	/**
	 * Upserts all records present in the specified table
	 *
	 * ***NOTE: This function replaces the existing record data with the specified data**
	 *
	 * @param table The table to upsert
	 * @param data The record data to upsert
	 */
	async upsert<T extends Doc, U extends Doc = T>(
		thing: Table,
		data?: U,
	): Promise<ActionResult<T>[]>;

	// Shadow implementation
	async upsert<T extends Doc, U extends Doc = T>(
		thing: RecordId | RecordIdRange | Table,
		data?: U,
	) {
		await this.ready;
		const res = await this.rpc<ActionResult<T>>("upsert", [thing, data]);
		if (res.error) throw new ResponseError(res.error.message);
		return output(thing, res.result);
	}

	/**
	 * Merges a single record based on the provided Record ID
	 *
	 * @param recordId The record ID to merge
	 * @param data The record data to merge
	 */
	async merge<T extends Doc, U extends Doc = Partial<T>>(
		thing: RecordId,
		data?: U,
	): Promise<ActionResult<T>>;

	/**
	 * Merges all records based on the provided Record ID range
	 *
	 * @param range The range of record IDs to merge
	 * @param data The record data to merge
	 */
	async merge<T extends Doc, U extends Doc = Partial<T>>(
		thing: RecordIdRange,
		data?: U,
	): Promise<ActionResult<T>[]>;

	/**
	 * Merges all records present in the specified table
	 *
	 * @param table The table to merge
	 * @param data The record data to merge
	 */
	async merge<T extends Doc, U extends Doc = Partial<T>>(
		thing: Table,
		data?: U,
	): Promise<ActionResult<T>[]>;

	// Shadow implementation
	async merge<T extends Doc, U extends Doc = Partial<T>>(
		thing: RecordId | RecordIdRange | Table,
		data?: U,
	) {
		await this.ready;
		const res = await this.rpc<ActionResult<T>>("merge", [thing, data]);
		if (res.error) throw new ResponseError(res.error.message);
		return output(thing, res.result);
	}

	/**
	 * Applies JSON Patch changes to all records, or a specific record, in the database
	 *
	 * ***NOTE: This function patches the existing record data with the specified JSON Patch operations***
	 *
	 * @param what The table name, record ID range, or specifc record ID to patch
	 * @param data The JSON Patch operations to apply
	 */
	async patch<T extends Doc>(
		what: RecordId,
		data?: Patch[],
		diff?: false,
	): Promise<ActionResult<T>>;
	async patch<T extends Doc>(
		what: RecordIdRange | Table,
		data?: Patch[],
		diff?: false,
	): Promise<ActionResult<T>[]>;
	async patch<T extends Doc>(
		what: RecordId,
		data: undefined | Patch[],
		diff: true,
	): Promise<Patch[]>;
	async patch<T extends Doc>(
		what: RecordIdRange | Table,
		data: undefined | Patch[],
		diff: true,
	): Promise<Patch[][]>;
	async patch(
		what: RecordId | RecordIdRange | Table,
		data?: Patch[],
		diff?: boolean,
	) {
		await this.ready;
		const res = await this.rpc<unknown>("patch", [what, data, diff]);
		if (res.error) throw new ResponseError(res.error.message);
		return diff ? res.result : output(what, res.result);
	}

	/**
	 * Deletes a single record from the database based on the provided Record ID
	 *
	 * @param recordId The record ID to delete
	 */
	async delete<T extends Doc>(recordId: RecordId): Promise<ActionResult<T>>;

	/**
	 * Deletes all records based on the provided Record ID range
	 *
	 * @param range The range of record IDs to delete
	 */
	async delete<T extends Doc>(thing: RecordIdRange): Promise<ActionResult<T>[]>;

	/**
	 * Deletes all records present in the specified table
	 *
	 * @param table The table to delete
	 */
	async delete<T extends Doc>(table: Table): Promise<ActionResult<T>[]>;

	// Shadow implementation
	async delete<T extends Doc>(thing: RecordId | RecordIdRange | Table) {
		await this.ready;
		const res = await this.rpc<ActionResult<T>>("delete", [thing]);
		if (res.error) throw new ResponseError(res.error.message);
		return output(thing, res.result);
	}

	/**
	 * Retrieves the version of the connected SurrealDB instance
	 *
	 * @example `surrealdb-2.1.0`
	 */
	async version(): Promise<string> {
		await this.ready;
		const res = await this.rpc<string>("version");
		if (res.error) throw new ResponseError(res.error.message);
		return res.result;
	}

	/**
	 * Run a SurrealQL function and return the result
	 *
	 * @param name The full name of the function to run
	 * @param args The arguments supplied to the function
	 */
	async run<T>(name: string, args?: unknown[]): Promise<T>;

	/**
	 * Run a SurrealML function with the specified version and return the result
	 *
	 * @param name The full name of the function to run
	 * @param version The version of the function to use
	 * @param args The arguments supplied to the function
	 */
	async run<T>(name: string, version: string, args?: unknown[]): Promise<T>;

	// Shadow implementation
	async run(name: string, arg2?: string | unknown[], arg3?: unknown[]) {
		await this.ready;
		const [version, args] = Array.isArray(arg2)
			? [undefined, arg2]
			: [arg2, arg3];

		const res = await this.rpc("run", [name, version, args]);
		if (res.error) throw new ResponseError(res.error.message);
		return res.result;
	}

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
}
