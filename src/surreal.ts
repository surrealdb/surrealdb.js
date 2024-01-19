import { NoActiveSocket, UnexpectedResponse } from "./errors.ts";
import { PreparedQuery } from "./index.ts";
import { Pinger } from "./library/Pinger.ts";
import { SurrealSocket } from "./library/SurrealSocket.ts";
import { Connection, WebsocketConnection } from "./library/connection.ts";
import { RecordId } from "./library/data/recordid.ts";
import { Action, LiveHandler } from "./library/live.ts";
import { processAuthVars } from "./library/processAuthVars.ts";
import { RpcResponse } from "./library/rpc.ts";
import {
	type ActionResult,
	AnyAuth,
	type ConnectionOptions,
	type MapQueryResult,
	type Patch,
	processConnectionOptions,
	type RawQueryResult,
	ScopeAuth,
	type StatusHooks,
	Token,
	TransformAuth,
} from "./types.ts";

export class Surreal {
	public connection: Connection | undefined;
	private pinger?: Pinger;
	public readonly strategy: 'websocket' | 'http';
	private readonly hooks: StatusHooks;
	ready?: Promise<void>;

	constructor({
		hooks,
		strategy
	}: {
		strategy?: 'websocket' | 'http';
		hooks?: StatusHooks;
	} = {}) {
		this.hooks = hooks ?? {};
		this.strategy = strategy ?? 'websocket';
	}

	/**
	 * Establish a socket connection to the database
	 * @param connection - Connection details
	 */
	async connect(
		url: string,
		opts: ConnectionOptions = {},
	) {
		const { prepare, auth, namespace, database } = processConnectionOptions(
			opts,
		);
		this.connection = new WebsocketConnection();
		this.ready = this.connection.connect(url);

		this.connection = {
			auth,
			namespace,
			database,
		};

		this.socket?.close(1000);
		this.pinger = new Pinger(30000);
		this.socket = new SurrealSocket({
			url,
			onConnect: async () => {
				this.pinger?.start(() => this.ping());
				if (this.connection.namespace && this.connection.database) {
					await this.use({});
				}
				if (typeof this.connection.auth === "string") {
					await this.authenticate(this.connection.auth);
				} else if (this.connection.auth) {
					await this.signin(this.connection.auth);
				}

				await prepare?.(this);
				this.resolveReady?.();
				this.hooks.onConnect?.();
			},
			onClose: () => {
				this.pinger?.stop();
				this.hooks.onClose?.();
			},
			onError: this.hooks.onError,
		});

		await this.socket.open().catch(this.rejectReady);
		return this.ready;
	}

	/**
	 * Disconnect the socket to the database
	 */
	async close() {
		await this.socket?.close(1000);
		this.socket = undefined;
	}

	/**
	 * Check if connection is ready
	 */
	async wait() {
		if (!this.socket) throw new NoActiveSocket();
		await this.ready;
	}

	/**
	 * Get status of the socket connection
	 */
	get status() {
		if (!this.socket) throw new NoActiveSocket();
		return this.socket.connectionStatus;
	}

	/**
	 * Ping SurrealDB instance
	 */
	async ping() {
		const { error } = await this.send("ping");
		if (error) throw new Error(error.message);
	}

	/**
	 * Switch to a specific namespace and database.
	 * @param database - Switches to a specific namespace.
	 * @param db - Switches to a specific database.
	 */
	async use(
		{ namespace, database }: { namespace?: string; database?: string },
	) {
		if (!namespace && !this.connection.namespace) {
			throw new Error("Please specify a namespace to use.");
		}
		if (!database && !this.connection.database) {
			throw new Error("Please specify a database to use.");
		}

		this.connection.namespace = namespace ?? this.connection.namespace;
		this.connection.database = database ?? this.connection.database;
		const { error } = await this.send("use", [
			this.connection.namespace,
			this.connection.database,
		]);

		if (error) throw new Error(error.message);
	}

	/**
	 * Selects everything from the [$auth](https://surrealdb.com/docs/surrealql/parameters) variable.
	 * ```sql
	 * SELECT * FROM $auth;
	 * ```
	 * Make sure the user actually has the permission to select their own record, otherwise you'll get back an empty result.
	 * @return The record linked to the record ID used for authentication
	 */
	async info<T extends Record<string, unknown> = Record<string, unknown>>() {
		await this.ready;
		const res = await this.send<ActionResult<T> | undefined>("info");
		if (res.error) throw new Error(res.error.message);
		return res.result ?? undefined;
	}

	/**
	 * Signs up to a specific authentication scope.
	 * @param vars - Variables used in a signup query.
	 * @return The authentication token.
	 */
	async signup(vars: ScopeAuth) {
		vars = ScopeAuth.parse(vars);
		vars = processAuthVars(vars, {
			namespace: this.connection.namespace,
			database: this.connection.database,
		});

		const res = await this.send<string>("signup", [
			TransformAuth.parse(vars),
		]);
		if (res.error) throw new Error(res.error.message);
		if (!res.result) {
			throw new Error("Did not receive authentication token");
		}
		this.connection.auth = res.result;
		return res.result;
	}

	/**
	 * Signs in to a specific authentication scope.
	 * @param vars - Variables used in a signin query.
	 * @return The authentication token.
	 */
	async signin(vars: AnyAuth) {
		vars = AnyAuth.parse(vars);
		vars = processAuthVars(vars, {
			namespace: this.connection.namespace,
			database: this.connection.database,
		});

		const res = await this.send<string>("signin", [
			TransformAuth.parse(vars),
		]);
		if (res.error) throw new Error(res.error.message);
		if (!res.result) {
			throw new Error("Did not receive authentication token");
		}
		this.connection.auth = res.result;
		return res.result;
	}

	/**
	 * Authenticates the current connection with a JWT token.
	 * @param token - The JWT authentication token.
	 */
	async authenticate(token: Token) {
		const res = await this.send<string>("authenticate", [
			Token.parse(token),
		]);
		if (res.error) throw new Error(res.error.message);
		this.connection.auth = token;
		return !!token;
	}

	/**
	 * Invalidates the authentication for the current connection.
	 */
	async invalidate() {
		const res = await this.send("invalidate");
		if (res.error) throw new Error(res.error.message);
		this.connection.auth = undefined;
	}

	/**
	 * Specify a variable for the current socket connection.
	 * @param key - Specifies the name of the variable.
	 * @param val - Assigns the value to the variable name.
	 */
	async let(variable: string, value: unknown) {
		const res = await this.send("let", [variable, value]);
		if (res.error) throw new Error(res.error.message);
	}

	/**
	 * Remove a variable from the current socket connection.
	 * @param key - Specifies the name of the variable.
	 */
	async unset(variable: string) {
		const res = await this.send("unset", [variable]);
		if (res.error) throw new Error(res.error.message);
	}

	/**
	 * Start a live query and listen for the responses
	 * @param table - The table that you want to receive live results for.
	 * @param callback - Callback function that receives updates.
	 * @param diff - If set to true, will return a set of patches instead of complete records
	 */
	async live<Result extends Record<string, unknown> | Patch = Record<string, unknown>>(
		table: string,
		callback?: LiveHandler<Result>,
		diff?: boolean,
	) {
		await this.ready;
		const res = await this.send<string>("live", [table, diff]);

		if (res.error) throw new Error(res.error.message);
		if (callback) this.subscribeLive<Result>(res.result, callback);

		return res.result;
	}

	/**
	 * Listen for live query responses by it's uuid
	 * @param queryUuid - The LQ uuid that you want to receive live results for.
	 * @param callback - Callback function that receives updates.
	 */
	async subscribeLive<
		Result extends Record<string, unknown> | Patch = Record<string, unknown>,
	>(queryUuid: string, callback: LiveHandler<Result>) {
		await this.ready;
		if (!this.connection) throw new NoActiveSocket();
		this.connection.emitter.subscribe(
			`live-${queryUuid}`,
			callback as (action: Action, result: Record<string, unknown> | Patch) => unknown,
			true
		);
	}

	/**
	 * Listen for live query responses by it's uuid
	 * @param queryUuid - The LQ uuid that you want to receive live results for.
	 * @param callback - Callback function that receives updates.
	 */
	async unSubscribeLive<
		Result extends Record<string, unknown> | Patch = Record<string, unknown>,
	>(queryUuid: string, callback: LiveHandler<Result>) {
		await this.ready;
		if (!this.connection) throw new NoActiveSocket();
		this.connection.emitter.unSubscribe(
			`live-${queryUuid}`,
			callback as (action: Action, result: Record<string, unknown> | Patch) => unknown
		);
	}

	/**
	 * Kill a live query
	 * @param uuid - The query that you want to kill.
	 */
	async kill(queryUuid: string | string[]) {
		await this.ready;
		if (!this.connection) throw new NoActiveSocket();
		if (Array.isArray(queryUuid)) {
			await Promise.all(queryUuid.map((u) => this.send('kill', [u])));
			const toBeKilled = queryUuid.map(u => `live-${u}` as const);
			this.connection.emitter.reset({
				collectable: toBeKilled,
				listeners: toBeKilled,
			});
		} else {
			await this.send('kill', [queryUuid]);
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
	async query<T extends RawQueryResult[]>(
		query: string | PreparedQuery,
		bindings?: Record<string, unknown>,
	) {
		const raw = await this.query_raw<T>(query, bindings);
		return raw.map(({ status, result, detail }) => {
			if (status == "ERR") throw new Error(detail ?? result);
			return result;
		}) as T;
	}

	/**
	 * Runs a set of SurrealQL statements against the database.
	 * @param query - Specifies the SurrealQL statements.
	 * @param bindings - Assigns variables which can be used in the query.
	 */
	async query_raw<T extends RawQueryResult[]>(
		query: string | PreparedQuery,
		bindings?: Record<string, unknown>,
	) {
		if (typeof query !== "string") {
			bindings = bindings ?? {};
			bindings = { ...bindings, ...query.bindings };
			query = query.query;
		}

		await this.ready;
		const res = await this.send<MapQueryResult<T>>("query", [
			query,
			bindings,
		]);
		if (res.error) throw new Error(res.error.message);
		return res.result;
	}

	/**
	 * Selects all records in a table, or a specific record, from the database.
	 * @param thing - The table name or a record ID to select.
	 */
	async select<T extends Record<string, unknown>>(thing: string | RecordId) {
		await this.ready;
		const res = await this.send<ActionResult<T>>("select", [thing]);
		return this.outputHandler(res);
	}

	/**
	 * Creates a record in the database.
	 * @param thing - The table name or the specific record ID to create.
	 * @param data - The document / record data to insert.
	 */
	async create<
		T extends Record<string, unknown>,
		U extends Record<string, unknown> = T,
	>(thing: string | RecordId, data?: U) {
		await this.ready;
		const res = await this.send<ActionResult<T, U>>("create", [
			thing,
			data,
		]);
		return this.outputHandler(res);
	}

	/**
	 * Inserts one or multiple records in the database.
	 * @param thing - The table name or the specific record ID to create.
	 * @param data - The document(s) / record(s) to insert.
	 */
	async insert<
		T extends Record<string, unknown>,
		U extends Record<string, unknown> = T,
	>(thing: string | RecordId, data?: U | U[]) {
		await this.ready;
		const res = await this.send<ActionResult<T, U>>("insert", [
			thing,
			data,
		]);
		return this.outputHandler(res);
	}

	/**
	 * Updates all records in a table, or a specific record, in the database.
	 *
	 * ***NOTE: This function replaces the current document / record data with the specified data.***
	 * @param thing - The table name or the specific record ID to update.
	 * @param data - The document / record data to insert.
	 */
	async update<
		T extends Record<string, unknown>,
		U extends Record<string, unknown> = T,
	>(thing: string | RecordId, data?: U) {
		await this.ready;
		const res = await this.send<ActionResult<T, U>>("update", [
			thing,
			data,
		]);
		return this.outputHandler(res);
	}

	/**
	 * Modifies all records in a table, or a specific record, in the database.
	 *
	 * ***NOTE: This function merges the current document / record data with the specified data.***
	 * @param thing - The table name or the specific record ID to change.
	 * @param data - The document / record data to insert.
	 */
	async merge<
		T extends Record<string, unknown>,
		U extends Record<string, unknown> = Partial<T>,
	>(thing: string | RecordId, data?: U) {
		await this.ready;
		const res = await this.send<ActionResult<U>>("merge", [thing, data]);
		return this.outputHandler(res);
	}

	/**
	 * Applies JSON Patch changes to all records, or a specific record, in the database.
	 *
	 * ***NOTE: This function patches the current document / record data with the specified JSON Patch data.***
	 * @param thing - The table name or the specific record ID to modify.
	 * @param data - The JSON Patch data with which to modify the records.
	 */
	async patch(thing: RecordId, data?: Patch[]) {
		await this.ready;
		const res = await this.send<Patch>("patch", [thing, data]);
		return this.outputHandler(res);
	}

	/**
	 * Deletes all records in a table, or a specific record, from the database.
	 * @param thing - The table name or a record ID to select.
	 */
	async delete<T extends Record<string, unknown> = Record<string, unknown>>(
		thing: string | RecordId<string>,
	) {
		await this.ready;
		const res = await this.send<ActionResult<T>>("delete", [thing]);
		return this.outputHandler(res);
	}

	/**
	 * Send a raw message to the SurrealDB instance
	 * @param method - Type of message to send.
	 * @param params - Parameters for the message.
	 */
	protected send<Result extends unknown>(
		method: string,
		params?: unknown[],
	) {
		if (!this.connection) throw new NoActiveSocket();
		return this.connection.send<typeof method, typeof params, Result>({ method, params });
	}

	/**
	 * Process a response by the SurrealDB instance
	 * @param res - The raw response
	 * @param thing - What thing did you query (table vs record).
	 */
	private outputHandler<T extends Record<string, unknown>>(res: RpcResponse<T>) {
		if (res.error) throw new Error(res.error.message);
		if (Array.isArray(res.result)) {
			return res.result as T[];
		} else if ("id" in (res.result ?? {})) {
			return [res.result] as T[];
		} else if (res.result === null) {
			return [] as T[];
		}

		console.debug({ res });
		throw new UnexpectedResponse();
	}
}
