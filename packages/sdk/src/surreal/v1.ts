import type {
	ConnectionStatus,
	ConnectOptions,
	DriverOptions,
	EventPublisher,
	ExportOptions,
	LiveHandler,
	Patch,
	Prettify,
	RpcResponse,
	Subscribe,
} from "../types";

import type { RecordIdRange, Table, Uuid, RecordId } from "../value";
import { Publisher } from "../internal/publisher";
import { ConnectionController } from "../controller";
import { decodeCbor, encodeCbor } from "../cbor";
import { AuthController } from "../controller/auth";
import { LiveController } from "../controller/live";
import { parseEndpoint } from "../internal/http";

export type SurrealV1Events = {
	connecting: [];
	connected: [];
	reconnecting: [];
	disconnected: [];
};

/**
 * An interface for communicating to SurrealDB over the v1 RPC protocol
 */
export class SurrealV1 implements EventPublisher<SurrealV1Events> {
	readonly #publisher = new Publisher<SurrealV1Events>();
	readonly #connection: ConnectionController;

	subscribe: Subscribe<SurrealV1Events> = this.#publisher.subscribe;

	constructor(options: DriverOptions = {}) {
		this.#connection = new ConnectionController({
			options,
			encode: encodeCbor,
			decode: decodeCbor,
		});
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
	 * Returns the status of the connection
	 */
	get status(): ConnectionStatus {
		return this.#connection.status;
	}

	/**
	 * A promise which resolves when the connection is ready
	 */
	get ready(): Promise<void> {
		throw new Error("Not implemented");
	}

	/**
	 * Ping SurrealDB instance
	 */
	async ping(): Promise<true> {
		throw new Error("Not implemented");
	}

	/**
	 * Switch to a specific namespace and database.
	 * @param database - Switches to a specific namespace.
	 * @param db - Switches to a specific database.
	 */
	async use({
		namespace,
		database,
	}: {
		namespace?: string | null;
		database?: string | null;
	}): Promise<true> {
		throw new Error("Not implemented");
	}

	/**
	 * Selects everything from the [$auth](https://surrealdb.com/docs/surrealql/parameters) variable.
	 * ```sql
	 * SELECT * FROM $auth;
	 * ```
	 * Make sure the user actually has the permission to select their own record, otherwise you'll get back an empty result.
	 * @return The record linked to the record ID used for authentication
	 */
	async info<T extends R>(): Promise<ActionResult<T> | undefined> {
		throw new Error("Not implemented");
	}

	/**
	 * Specify a variable for the current socket connection.
	 * @param key - Specifies the name of the variable.
	 * @param val - Assigns the value to the variable name.
	 */
	async let(variable: string, value: unknown): Promise<true> {
		throw new Error("Not implemented");
	}

	/**
	 * Remove a variable from the current socket connection.
	 * @param key - Specifies the name of the variable.
	 */
	async unset(variable: string): Promise<true> {
		throw new Error("Not implemented");
	}

	/**
	 * Start a live select query and invoke the callback with responses
	 * @param table - The table that you want to receive live results for.
	 * @param callback - Callback function that receives updates.
	 * @param diff - If set to true, will return a set of patches instead of complete records
	 * @returns A unique subscription ID
	 */
	async live<
		Result extends Record<string, unknown> | Patch = Record<string, unknown>,
	>(
		table: RecordIdRange | Table | string,
		callback?: LiveHandler<Result>,
		diff?: boolean,
	): Promise<Uuid> {
		throw new Error("Not implemented");
	}

	/**
	 * Subscribe to an existing live select query and invoke the callback with responses
	 * @param queryUuid - The unique ID of an existing live query you want to receive updates for.
	 * @param callback - Callback function that receives updates.
	 */
	async subscribeLive<
		Result extends Record<string, unknown> | Patch = Record<string, unknown>,
	>(queryUuid: Uuid, callback: LiveHandler<Result>): Promise<void> {
		throw new Error("Not implemented");
	}

	/**
	 * Unsubscribe a callback from a live select query
	 * @param queryUuid - The unique ID of an existing live query you want to ubsubscribe from.
	 * @param callback - The previously subscribed callback function.
	 */
	async unSubscribeLive<
		Result extends Record<string, unknown> | Patch = Record<string, unknown>,
	>(queryUuid: Uuid, callback: LiveHandler<Result>): Promise<void> {
		throw new Error("Not implemented");
	}

	/**
	 * Kill a live query
	 * @param queryUuid - The query that you want to kill.
	 */
	async kill(queryUuid: Uuid | readonly Uuid[]): Promise<void> {
		throw new Error("Not implemented");
	}

	/**
	 * Runs a set of SurrealQL statements against the database.
	 * @param query - Specifies the SurrealQL statements.
	 * @param bindings - Assigns variables which can be used in the query.
	 */
	async query<T extends unknown[]>(
		...args: QueryParameters
	): Promise<Prettify<T>> {
		throw new Error("Not implemented");
	}

	/**
	 * Runs a set of SurrealQL statements against the database.
	 * @param query - Specifies the SurrealQL statements.
	 * @param bindings - Assigns variables which can be used in the query.
	 */
	async queryRaw<T extends unknown[]>(
		...[q, b]: QueryParameters
	): Promise<Prettify<MapQueryResult<T>>> {
		throw new Error("Not implemented");
	}

	/**
	 * Runs a set of SurrealQL statements against the database.
	 * @param query - Specifies the SurrealQL statements.
	 * @param bindings - Assigns variables which can be used in the query.
	 * @deprecated Use `queryRaw` instead
	 */
	async query_raw<T extends unknown[]>(
		...args: QueryParameters
	): Promise<Prettify<MapQueryResult<T>>> {
		throw new Error("Not implemented");
	}

	/**
	 * Selects all records in a table, or a specific record, from the database.
	 * If you intend on sorting, filtering, or performing other operations on the data, it is recommended to use the `query` method instead.
	 * @param thing - The table name or a record ID to select.
	 */
	async select<T extends R>(thing: RecordId): Promise<ActionResult<T>>;
	async select<T extends R>(
		thing: RecordIdRange | Table | string,
	): Promise<ActionResult<T>[]>;
	async select<T extends R>(thing: RecordId | RecordIdRange | Table | string) {
		throw new Error("Not implemented");
	}

	/**
	 * Creates a record in the database.
	 * @param thing - The table name or the specific record ID to create.
	 * @param data - The document / record data to insert.
	 */
	async create<T extends R, U extends R = T>(
		thing: RecordId,
		data?: U,
	): Promise<ActionResult<T>>;
	async create<T extends R, U extends R = T>(
		thing: Table | string,
		data?: U,
	): Promise<ActionResult<T>[]>;
	async create<T extends R, U extends R = T>(
		thing: RecordId | Table | string,
		data?: U,
	) {
		throw new Error("Not implemented");
	}

	/**
	 * Inserts one or multiple records in the database.
	 * @param table - The table name to insert into.
	 * @param data - The document(s) / record(s) to insert.
	 */
	async insert<T extends R, U extends R = T>(
		data?: U | U[],
	): Promise<ActionResult<T>[]>;
	async insert<T extends R, U extends R = T>(
		table: Table | string,
		data?: U | U[],
	): Promise<ActionResult<T>[]>;
	async insert<T extends R, U extends R = T>(
		arg1: Table | string | U | U[],
		arg2?: U | U[],
	) {
		throw new Error("Not implemented");
	}

	/**
	 * Inserts one or multiple records in the database.
	 * @param thing - The table name or the specific record ID to create.
	 * @param data - The document(s) / record(s) to insert.
	 */
	async insertRelation<T extends R, U extends R = T>(
		data?: U | U[],
	): Promise<ActionResult<T>[]>;
	async insertRelation<T extends R, U extends R = T>(
		table: Table | string,
		data?: U | U[],
	): Promise<ActionResult<T>[]>;
	async insertRelation<T extends R, U extends R = T>(
		arg1: Table | string | U | U[],
		arg2?: U | U[],
	) {
		throw new Error("Not implemented");
	}

	/**
	 * Inserts one or multiple records in the database.
	 * @param thing - The table name or the specific record ID to create.
	 * @param data - The document(s) / record(s) to insert.
	 * @deprecated Use `insertRelation` instead
	 */
	async insert_relation<T extends R, U extends R = T>(
		data?: U | U[],
	): Promise<ActionResult<T>[]>;
	async insert_relation<T extends R, U extends R = T>(
		table: Table | string,
		data?: U | U[],
	): Promise<ActionResult<T>[]>;
	async insert_relation<T extends R, U extends R = T>(
		arg1: Table | string | U | U[],
		arg2?: U | U[],
	) {
		throw new Error("Not implemented");
	}

	/**
	 * Updates all records in a table, or a specific record, in the database.
	 *
	 * ***NOTE: This function replaces the current document / record data with the specified data.***
	 * @param thing - The table name or the specific record ID to update.
	 * @param data - The document / record data to insert.
	 */
	async update<T extends R, U extends R = T>(
		thing: RecordId,
		data?: U,
	): Promise<ActionResult<T>>;
	async update<T extends R, U extends R = T>(
		thing: RecordIdRange | Table | string,
		data?: U,
	): Promise<ActionResult<T>[]>;
	async update<T extends R, U extends R = T>(
		thing: RecordId | RecordIdRange | Table | string,
		data?: U,
	) {
		throw new Error("Not implemented");
	}

	/**
	 * Upserts all records in a table, or a specific record, in the database.
	 *
	 * ***NOTE: This function replaces the current document / record data with the specified data.***
	 * @param thing - The table name or the specific record ID to upsert.
	 * @param data - The document / record data to insert.
	 */
	async upsert<T extends R, U extends R = T>(
		thing: RecordId,
		data?: U,
	): Promise<ActionResult<T>>;
	async upsert<T extends R, U extends R = T>(
		thing: RecordIdRange | Table | string,
		data?: U,
	): Promise<ActionResult<T>[]>;
	async upsert<T extends R, U extends R = T>(
		thing: RecordId | RecordIdRange | Table | string,
		data?: U,
	) {
		throw new Error("Not implemented");
	}

	/**
	 * Modifies all records in a table, or a specific record, in the database.
	 *
	 * ***NOTE: This function merges the current document / record data with the specified data.***
	 * @param thing - The table name or the specific record ID to change.
	 * @param data - The document / record data to insert.
	 */
	async merge<T extends R, U extends R = Partial<T>>(
		thing: RecordId,
		data?: U,
	): Promise<ActionResult<T>>;
	async merge<T extends R, U extends R = Partial<T>>(
		thing: RecordIdRange | Table | string,
		data?: U,
	): Promise<ActionResult<T>[]>;
	async merge<T extends R, U extends R = Partial<T>>(
		thing: RecordId | RecordIdRange | Table | string,
		data?: U,
	) {
		throw new Error("Not implemented");
	}

	/**
	 * Applies JSON Patch changes to all records, or a specific record, in the database.
	 *
	 * ***NOTE: This function patches the current document / record data with the specified JSON Patch data.***
	 * @param thing - The table name or the specific record ID to modify.
	 * @param data - The JSON Patch data with which to modify the records.
	 */
	async patch<T extends R>(
		thing: RecordId,
		data?: Patch[],
		diff?: false,
	): Promise<ActionResult<T>>;
	async patch<T extends R>(
		thing: RecordIdRange | Table | string,
		data?: Patch[],
		diff?: false,
	): Promise<ActionResult<T>[]>;
	async patch<T extends R>(
		thing: RecordId,
		data: undefined | Patch[],
		diff: true,
	): Promise<Patch[]>;
	async patch<T extends R>(
		thing: RecordIdRange | Table | string,
		data: undefined | Patch[],
		diff: true,
	): Promise<Patch[][]>;
	async patch(
		thing: RecordId | RecordIdRange | Table | string,
		data?: Patch[],
		diff?: boolean,
	) {
		throw new Error("Not implemented");
	}

	/**
	 * Deletes all records in a table, or a specific record, from the database.
	 * @param thing - The table name or a record ID to select.
	 */
	async delete<T extends R>(thing: RecordId): Promise<ActionResult<T>>;
	async delete<T extends R>(
		thing: RecordIdRange | Table | string,
	): Promise<ActionResult<T>[]>;
	async delete<T extends R>(thing: RecordId | RecordIdRange | Table | string) {
		throw new Error("Not implemented");
	}

	/**
	 * Obtain the version of the SurrealDB instance
	 * @example `surrealdb-2.1.0`
	 */
	async version(): Promise<string> {
		throw new Error("Not implemented");
	}

	/**
	 * Run a SurrealQL function
	 * @param name - The full name of the function
	 * @param args - The arguments supplied to the function. You can also supply a version here as a string, in which case the third argument becomes the parameter list.
	 */
	async run<T>(name: string, args?: unknown[]): Promise<T>;
	/**
	 * Run a SurrealQL function
	 * @param name - The full name of the function
	 * @param version - The version of the function. If omitted, the second argument is the parameter list.
	 * @param args - The arguments supplied to the function.
	 */
	async run<T>(name: string, version: string, args?: unknown[]): Promise<T>;
	async run(name: string, arg2?: string | unknown[], arg3?: unknown[]) {
		throw new Error("Not implemented");
	}

	/**
	 * Obtain the version of the SurrealDB instance
	 * @param from - The in property on the edge record
	 * @param thing - The id of the edge record
	 * @param to - The out property on the edge record
	 * @param data - Optionally, provide a body for the edge record
	 */
	async relate<T extends R, U extends R = T>(
		from: string | RecordId | RecordId[],
		thing: RecordId,
		to: string | RecordId | RecordId[],
		data?: U,
	): Promise<T>;
	async relate<T extends R, U extends R = T>(
		from: string | RecordId | RecordId[],
		thing: string,
		to: string | RecordId | RecordId[],
		data?: U,
	): Promise<T[]>;
	async relate<T extends R, U extends R = T>(
		from: string | RecordId | RecordId[],
		thing: string | RecordId,
		to: string | RecordId | RecordId[],
		data?: U,
	) {
		throw new Error("Not implemented");
	}

	/**
	 * Send a raw message to the SurrealDB instance
	 * @param method - Type of message to send.
	 * @param params - Parameters for the message.
	 */
	public rpc<Result>(
		method: string,
		params?: unknown[],
	): Promise<RpcResponse<Result>> {
		throw new Error("Not implemented");
	}

	/**
	 * Export the database and return the result as a string
	 * @param options - Export configuration options
	 */
	public async export(options?: Partial<ExportOptions>): Promise<string> {
		throw new Error("Not implemented");
	}

	/**
	 * Import an existing export into the database
	 * @param input - The data to import
	 */
	public async import(input: string): Promise<void> {
		throw new Error("Not implemented");
	}
}
