import { NoActiveSocket, UnexpectedResponse } from "../errors.ts";
import { Pinger } from "../library/Pinger.ts";
import { SurrealSocket } from "../library/SurrealSocket.ts";
import { processAuthVars } from "../library/processAuthVars.ts";
import {
AnyAuth,
	type ActionResult,
	type Connection,
	type ConnectionOptions,
	type LiveQueryResponse,
	type MapQueryResult,
	type Patch,
	type RawQueryResult,
	type Result, ScopeAuth, Token,
TransformAuth,
processConnectionOptions,
} from "../types.ts";

export class WebSocketStrategy implements Connection {
	protected socket?: SurrealSocket;
	private pinger?: Pinger;
	private connection: {
		namespace?: string;
		database?: string;
		auth?: AnyAuth | Token;
	} = {};

	public ready?: Promise<void>;
	private resolveReady?: () => void;
	private rejectReady?: (e: Error) => void;

	public strategy: "ws" | "http" = "ws";

	/**
	 * Establish a socket connection to the database
	 * @param connection - Connection details
	 */
	async connect(
		url: string,
		opts: ConnectionOptions = {},
	) {
		const { prepare, auth, namespace, database } = processConnectionOptions(opts);
		this.ready = new Promise((resolve, reject) => {
			this.resolveReady = resolve;
			this.rejectReady = reject;
		});

		this.connection = {
			auth,
			namespace,
			database,
		};

		this.socket?.close(1000);
		this.pinger = new Pinger(30000);
		this.socket = new SurrealSocket({
			url,
			onOpen: async () => {
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
			},
			onClose: () => {
				this.pinger?.stop();
			},
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
	 * @param ns - Switches to a specific namespace.
	 * @param db - Switches to a specific database.
	 */
	async use({ namespace, database }: { namespace?: string; database?: string }) {
		if (!namespace && !this.connection.namespace)
			throw new Error("Please specify a namespace to use.");
		if (!database && !this.connection.database)
			throw new Error("Please specify a database to use.");

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

		const res = await this.send<string>("signup", [TransformAuth.parse(vars)]);
		if (res.error) throw new Error(res.error.message);
		if (!res.result) throw new Error("Did not receive authentication token");
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

		const res = await this.send<string>("signin", [TransformAuth.parse(vars)]);
		if (res.error) throw new Error(res.error.message);
		if (!res.result) throw new Error("Did not receive authentication token");
		this.connection.auth = res.result;
		return res.result;
	}

	/**
	 * Authenticates the current connection with a JWT token.
	 * @param token - The JWT authentication token.
	 */
	async authenticate(token: Token) {
		const res = await this.send<string>("authenticate", [Token.parse(token)]);
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
	async live<T extends Record<string, unknown> = Record<string, unknown>>(
		table: string,
		callback?: (data: LiveQueryResponse<T>) => unknown,
		diff?: boolean,
	) {
		await this.ready;
		const res = await this.send<string>("live", [table, diff]);
		if (res.error) throw new Error(res.error.message);
		if (callback) this.listenLive<T>(res.result, callback);
		return res.result;
	}

	/**
	 * Listen for live query responses by it's uuid
	 * @param queryUuid - The LQ uuid that you want to receive live results for.
	 * @param callback - Callback function that receives updates.
	 */
	async listenLive<
		T extends Record<string, unknown> = Record<string, unknown>,
	>(queryUuid: string, callback: (data: LiveQueryResponse<T>) => unknown) {
		await this.ready;
		if (!this.socket) throw new NoActiveSocket();
		this.socket.listenLive(
			queryUuid,
			callback as (data: LiveQueryResponse) => unknown,
		);
	}

	/**
	 * Kill a live query
	 * @param uuid - The query that you want to kill.
	 */
	async kill(queryUuid: string) {
		await this.ready;
		if (!this.socket) throw new NoActiveSocket();
		await this.socket.kill(queryUuid);
	}

	/**
	 * Runs a set of SurrealQL statements against the database.
	 * @param query - Specifies the SurrealQL statements.
	 * @param vars - Assigns variables which can be used in the query.
	 */
	async query<T extends RawQueryResult[]>(
		query: string,
		vars?: Record<string, unknown>,
	) {
		await this.ready;
		const res = await this.send<MapQueryResult<T>>("query", [query, vars]);
		if (res.error) throw new Error(res.error.message);
		return res.result;
	}

	/**
	 * Selects all records in a table, or a specific record, from the database.
	 * @param thing - The table name or a record ID to select.
	 */
	async select<T extends Record<string, unknown>>(thing: string) {
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
	>(thing: string, data?: U) {
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
	>(thing: string, data?: U | U[]) {
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
	>(thing: string, data?: U) {
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
	>(thing: string, data?: U) {
		await this.ready;
		const res = await this.send<ActionResult<T, U>>("merge", [thing, data]);
		return this.outputHandler(res);
	}

	/**
	 * Applies JSON Patch changes to all records, or a specific record, in the database.
	 *
	 * ***NOTE: This function patches the current document / record data with the specified JSON Patch data.***
	 * @param thing - The table name or the specific record ID to modify.
	 * @param data - The JSON Patch data with which to modify the records.
	 */
	async patch(thing: string, data?: Patch[]) {
		await this.ready;
		const res = await this.send<Patch>("patch", [thing, data]);
		return this.outputHandler(res);
	}

	/**
	 * Deletes all records in a table, or a specific record, from the database.
	 * @param thing - The table name or a record ID to select.
	 */
	async delete<T extends Record<string, unknown> = Record<string, unknown>>(
		thing: string,
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
	protected send<T = unknown, U = Result<T>>(
		method: string,
		params?: unknown[],
	) {
		return new Promise<U>((resolve) => {
			if (!this.socket) throw new NoActiveSocket();
			this.socket.send(method, params ?? [], (r) => resolve(r as U));
		});
	}

	/**
	 * Process a response by the SurrealDB instance
	 * @param res - The raw response
	 * @param thing - What thing did you query (table vs record).
	 */
	private outputHandler<T extends Record<string, unknown>>(res: Result<T>) {
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
