import {
	StringRecordId,
	Table,
	type Uuid,
	RecordId as _RecordId,
	decodeCbor,
	encodeCbor,
} from "./data";
import {
	type AbstractEngine,
	ConnectionStatus,
	EngineContext,
	type EngineEvents,
	type Engines,
} from "./engines/abstract.ts";
import { Emitter } from "./util/emitter.ts";
import { PreparedQuery } from "./util/prepared-query.ts";
import { processAuthVars } from "./util/process-auth-vars.ts";
import { versionCheck } from "./util/version-check.ts";

import {
	type AccessRecordAuth,
	type ActionResult,
	type AnyAuth,
	type ExportOptions,
	type LiveHandler,
	type MapQueryResult,
	type Patch,
	type Prettify,
	type QueryParameters,
	type RpcResponse,
	type ScopeAuth,
	type Token,
	convertAuth,
} from "./types.ts";

import { type Fill, partiallyEncodeObject } from "./cbor";
import { replacer } from "./data/cbor.ts";
import type { RecordIdRange } from "./data/types/range.ts";
import { HttpEngine } from "./engines/http.ts";
import { WebsocketEngine } from "./engines/ws.ts";
import {
	EngineDisconnected,
	NoActiveSocket,
	NoTokenReturned,
	ResponseError,
	SurrealDbError,
	UnsupportedEngine,
} from "./errors.ts";

type R = Prettify<Record<string, unknown>>;
type RecordId<Tb extends string = string> = _RecordId<Tb> | StringRecordId;

export class Surreal {
	public connection: AbstractEngine | undefined;
	ready?: Promise<void>;
	emitter: Emitter<EngineEvents>;
	protected engines: Engines = {
		ws: WebsocketEngine,
		wss: WebsocketEngine,
		http: HttpEngine,
		https: HttpEngine,
	};

	constructor({
		engines,
	}: {
		engines?: Engines;
	} = {}) {
		this.emitter = new Emitter();
		this.emitter.subscribe(ConnectionStatus.Disconnected, () => this.clean());
		this.emitter.subscribe(ConnectionStatus.Error, () => this.close());

		if (engines) {
			this.engines = {
				...this.engines,
				...engines,
			};
		}
	}

	/**
	 * Establish a socket connection to the database
	 * @param connection - Connection details
	 */
	async connect(
		url: string | URL,
		opts: {
			namespace?: string;
			database?: string;
			auth?: AnyAuth | Token;
			prepare?: (connection: Surreal) => unknown;
			versionCheck?: boolean;
			versionCheckTimeout?: number;
		} = {},
	): Promise<true> {
		// biome-ignore lint/style/noParameterAssign: Need to ensure it's a URL
		url = new URL(url);

		if (!url.pathname.endsWith("/rpc")) {
			if (!url.pathname.endsWith("/")) url.pathname += "/";
			url.pathname += "rpc";
		}

		const engineName = url.protocol.slice(0, -1);
		const engine = this.engines[engineName];
		if (!engine) throw new UnsupportedEngine(engineName);

		// Process options
		const { prepare, auth, namespace, database } = opts;

		// Close any existing connections
		await this.close();

		// We need to pass CBOR encoding and decoding functions as an argument to engines,
		// to ensure that everything is using the same instance of classes that these methods depend on.
		const context = new EngineContext({
			emitter: this.emitter,
			encodeCbor,
			decodeCbor,
		});

		// The promise does not know if `this.connection` is undefined or not, but it does about `connection`
		const connection = new engine(context);

		// If not disabled, run a version check
		if (opts.versionCheck !== false) {
			const version = await connection.version(url, opts.versionCheckTimeout);
			versionCheck(version);
		}

		this.connection = connection;
		this.ready = new Promise((resolve, reject) =>
			connection
				.connect(url as URL)
				.then(async () => {
					if (namespace || database) {
						await this.use({
							namespace,
							database,
						});
					}

					if (typeof auth === "string") {
						await this.authenticate(auth);
					} else if (auth) {
						await this.signin(auth);
					}

					await prepare?.(this);
					resolve();
				})
				.catch(reject),
		);

		await this.ready;
		return true;
	}

	/**
	 * Disconnect the socket to the database
	 */
	async close(): Promise<true> {
		this.clean();
		await this.connection?.disconnect();
		return true;
	}

	private clean() {
		// Scan all pending rpc requests
		const pending = this.emitter.scanListeners((k) => k.startsWith("rpc-"));
		// Ensure all rpc requests get a connection closed response
		pending.map((k) => this.emitter.emit(k, [new EngineDisconnected()]));

		// Scan all active live listeners
		const live = this.emitter.scanListeners((k) => k.startsWith("live-"));
		// Ensure all live listeners get a CLOSE message with disconnected as reason
		live.map((k) => this.emitter.emit(k, ["CLOSE", "disconnected"]));

		// Cleanup subscriptions and yet to be collected emisions
		this.emitter.reset({
			collectable: true,
			listeners: [...pending, ...live],
		});
	}

	/**
	 * Check if connection is ready
	 */
	get status(): ConnectionStatus {
		return this.connection?.status ?? ConnectionStatus.Disconnected;
	}

	/**
	 * Ping SurrealDB instance
	 */
	async ping(): Promise<true> {
		const { error } = await this.rpc("ping");
		if (error) throw new ResponseError(error.message);
		return true;
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
		if (!this.connection) throw new NoActiveSocket();

		if (namespace === null && database !== null)
			throw new SurrealDbError(
				"Cannot unset namespace without unsetting database",
			);
		const { error } = await this.rpc("use", [namespace, database]);
		if (error) throw new ResponseError(error.message);
		return true;
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
		await this.ready;
		const res = await this.rpc<ActionResult<T> | undefined>("info");
		if (res.error) throw new ResponseError(res.error.message);
		return res.result ?? undefined;
	}

	/**
	 * Signs up to a specific authentication scope.
	 * @param vars - Variables used in a signup query.
	 * @return The authentication token.
	 */
	async signup(vars: ScopeAuth | AccessRecordAuth): Promise<Token> {
		if (!this.connection) throw new NoActiveSocket();

		const parsed = processAuthVars(vars, this.connection.connection);
		const converted = convertAuth(parsed);
		const res = await this.rpc<Token>("signup", [converted]);

		if (res.error) throw new ResponseError(res.error.message);
		if (!res.result) {
			throw new NoTokenReturned();
		}

		return res.result;
	}

	/**
	 * Signs in to a specific authentication scope.
	 * @param vars - Variables used in a signin query.
	 * @return The authentication token.
	 */
	async signin(vars: AnyAuth): Promise<Token> {
		if (!this.connection) throw new NoActiveSocket();

		const parsed = processAuthVars(vars, this.connection.connection);
		const converted = convertAuth(parsed);
		const res = await this.rpc<Token>("signin", [converted]);

		if (res.error) throw new ResponseError(res.error.message);
		if (!res.result) {
			throw new NoTokenReturned();
		}

		return res.result;
	}

	/**
	 * Authenticates the current connection with a JWT token.
	 * @param token - The JWT authentication token.
	 */
	async authenticate(token: Token): Promise<true> {
		const res = await this.rpc<string>("authenticate", [token]);
		if (res.error) throw new ResponseError(res.error.message);
		return true;
	}

	/**
	 * Invalidates the authentication for the current connection.
	 */
	async invalidate(): Promise<true> {
		const res = await this.rpc("invalidate");
		if (res.error) throw new ResponseError(res.error.message);
		return true;
	}

	/**
	 * Specify a variable for the current socket connection.
	 * @param key - Specifies the name of the variable.
	 * @param val - Assigns the value to the variable name.
	 */
	async let(variable: string, value: unknown): Promise<true> {
		const res = await this.rpc("let", [variable, value]);
		if (res.error) throw new ResponseError(res.error.message);
		return true;
	}

	/**
	 * Remove a variable from the current socket connection.
	 * @param key - Specifies the name of the variable.
	 */
	async unset(variable: string): Promise<true> {
		const res = await this.rpc("unset", [variable]);
		if (res.error) throw new ResponseError(res.error.message);
		return true;
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
		await this.ready;
		const res = await this.rpc<Uuid>("live", [table, diff]);

		if (res.error) throw new ResponseError(res.error.message);
		if (callback) this.subscribeLive<Result>(res.result, callback);

		return res.result;
	}

	/**
	 * Subscribe to an existing live select query and invoke the callback with responses
	 * @param queryUuid - The unique ID of an existing live query you want to receive updates for.
	 * @param callback - Callback function that receives updates.
	 */
	async subscribeLive<
		Result extends Record<string, unknown> | Patch = Record<string, unknown>,
	>(queryUuid: Uuid, callback: LiveHandler<Result>): Promise<void> {
		await this.ready;
		if (!this.connection) throw new NoActiveSocket();
		this.connection.emitter.subscribe(
			`live-${queryUuid}`,
			callback as LiveHandler,
			true,
		);
	}

	/**
	 * Unsubscribe a callback from a live select query
	 * @param queryUuid - The unique ID of an existing live query you want to ubsubscribe from.
	 * @param callback - The previously subscribed callback function.
	 */
	async unSubscribeLive<
		Result extends Record<string, unknown> | Patch = Record<string, unknown>,
	>(queryUuid: Uuid, callback: LiveHandler<Result>): Promise<void> {
		await this.ready;
		if (!this.connection) throw new NoActiveSocket();
		this.connection.emitter.unSubscribe(
			`live-${queryUuid}`,
			callback as LiveHandler,
		);
	}

	/**
	 * Kill a live query
	 * @param queryUuid - The query that you want to kill.
	 */
	async kill(queryUuid: Uuid | readonly Uuid[]): Promise<void> {
		await this.ready;
		if (!this.connection) throw new NoActiveSocket();
		if (Array.isArray(queryUuid)) {
			await Promise.all(queryUuid.map((u) => this.rpc("kill", [u])));
			const toBeKilled = queryUuid.map((u) => `live-${u}` as const);
			toBeKilled.map((k) => this.emitter.emit(k, ["CLOSE", "killed"]));
			this.connection.emitter.reset({
				collectable: toBeKilled,
				listeners: toBeKilled,
			});
		} else {
			await this.rpc("kill", [queryUuid]);
			this.emitter.emit(`live-${queryUuid}`, ["CLOSE", "killed"]);
			this.connection.emitter.reset({
				collectable: `live-${queryUuid}`,
				listeners: `live-${queryUuid}`,
			});
		}
	}

	/**
	 * Runs a set of SurrealQL statements against the database.
	 * @param query - Specifies the SurrealQL statements.
	 * @param bindings - Assigns variables which can be used in the query.
	 */
	async query<T extends unknown[]>(
		...args: QueryParameters
	): Promise<Prettify<T>> {
		const raw = await this.queryRaw<T>(...args);
		return raw.map(({ status, result }) => {
			if (status === "ERR") throw new ResponseError(result);
			return result;
		}) as T;
	}

	/**
	 * Runs a set of SurrealQL statements against the database.
	 * @param query - Specifies the SurrealQL statements.
	 * @param bindings - Assigns variables which can be used in the query.
	 */
	async queryRaw<T extends unknown[]>(
		...[q, b]: QueryParameters
	): Promise<Prettify<MapQueryResult<T>>> {
		const params =
			q instanceof PreparedQuery
				? [
						q.query,
						partiallyEncodeObject(q.bindings, {
							fills: b as Fill[],
							replacer: replacer.encode,
						}),
					]
				: [q, b];

		await this.ready;
		const res = await this.rpc<MapQueryResult<T>>("query", params);
		if (res.error) throw new ResponseError(res.error.message);
		return res.result;
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
		return this.queryRaw<T>(...args);
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
		await this.ready;
		const res = await this.rpc<ActionResult<T>>("select", [thing]);
		if (res.error) throw new ResponseError(res.error.message);
		return output(thing, res.result);
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
		await this.ready;
		const res = await this.rpc<ActionResult<T>>("create", [thing, data]);
		if (res.error) throw new ResponseError(res.error.message);
		return output(thing, res.result);
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
		await this.ready;
		const [table, data] =
			typeof arg1 === "string" || arg1 instanceof Table
				? [arg1, arg2]
				: [undefined, arg1];
		const res = await this.rpc<ActionResult<T>>("insert", [table, data]);
		if (res.error) throw new ResponseError(res.error.message);
		return res.result;
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
		await this.ready;
		const [table, data] =
			typeof arg1 === "string" || arg1 instanceof Table
				? [arg1, arg2]
				: [undefined, arg1];
		const res = await this.rpc<ActionResult<T>>("insert_relation", [
			table,
			data,
		]);
		if (res.error) throw new ResponseError(res.error.message);
		return res.result;
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
		return arg1 instanceof Table || typeof arg1 === "string"
			? this.insertRelation(arg1, arg2)
			: this.insertRelation(arg1);
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
		await this.ready;
		const res = await this.rpc<ActionResult<T>>("update", [thing, data]);
		if (res.error) throw new ResponseError(res.error.message);
		return output(thing, res.result);
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
		await this.ready;
		const res = await this.rpc<ActionResult<T>>("upsert", [thing, data]);
		if (res.error) throw new ResponseError(res.error.message);
		return output(thing, res.result);
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
		await this.ready;
		const res = await this.rpc<ActionResult<T>>("merge", [thing, data]);
		if (res.error) throw new ResponseError(res.error.message);
		return output(thing, res.result);
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
		await this.ready;

		// biome-ignore lint/suspicious/noExplicitAny: Cannot assume type here due to function overload
		const res = await this.rpc<any>("patch", [thing, data, diff]);

		if (res.error) throw new ResponseError(res.error.message);
		return diff ? res.result : output(thing, res.result);
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
		await this.ready;
		const res = await this.rpc<ActionResult<T>>("delete", [thing]);
		if (res.error) throw new ResponseError(res.error.message);
		return output(thing, res.result);
	}

	/**
	 * Obtain the version of the SurrealDB instance
	 * @example `surrealdb-2.1.0`
	 */
	async version(): Promise<string> {
		await this.ready;
		const res = await this.rpc<string>("version");
		if (res.error) throw new ResponseError(res.error.message);
		return res.result;
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
		await this.ready;
		const [version, args] = Array.isArray(arg2)
			? [undefined, arg2]
			: [arg2, arg3];

		const res = await this.rpc("run", [name, version, args]);
		if (res.error) throw new ResponseError(res.error.message);
		return res.result;
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
		await this.ready;
		const res = await this.rpc("relate", [from, thing, to, data]);
		if (res.error) throw new ResponseError(res.error.message);
		return output(thing, res.result);
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
		if (!this.connection) throw new NoActiveSocket();
		return this.connection.rpc<typeof method, typeof params, Result>({
			method,
			params,
		});
	}

	/**
	 * Export the database and return the result as a string
	 * @param options - Export configuration options
	 */
	public async export(options?: Partial<ExportOptions>): Promise<string> {
		await this.ready;
		if (!this.connection) throw new NoActiveSocket();
		return this.connection.export(options);
	}

	/**
	 * Import an existing export into the database
	 * @param input - The data to import
	 */
	public async import(input: string): Promise<void> {
		await this.ready;
		if (!this.connection) throw new NoActiveSocket();
		return this.connection.import(input);
	}
}

type Output<T, S> = S extends RecordId ? T : T[];
function output<T, S>(subject: S, input: T | T[]): Output<T, S> {
	const one = subject instanceof _RecordId || subject instanceof StringRecordId;
	if (one) return (Array.isArray(input) ? input[0] : input) as Output<T, S>;
	return (Array.isArray(input) ? input : [input]) as Output<T, S>;
}
