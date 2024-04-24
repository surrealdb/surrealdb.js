import {
	EngineDisconnected,
	NoActiveSocket,
	NoDatabaseSpecified,
	NoNamespaceSpecified,
	NoTokenReturned,
	ResponseError,
	UnsupportedEngine,
} from "./errors.ts";
import { PreparedQuery } from "./library/PreparedQuery.ts";
import { Pinger } from "./library/Pinger.ts";
import { EngineEvents } from "./library/engine.ts";
import { Engine, HttpEngine, WebsocketEngine } from "./library/engine.ts";
import { RecordId } from "./library/cbor/recordid.ts";
import { Emitter } from "./library/emitter.ts";
import { processAuthVars } from "./library/processAuthVars.ts";
import type { UUID } from "./library/cbor/uuid.ts";
import {
	Action,
	type ActionResult,
	AnyAuth,
	type ConnectionOptions,
	LiveHandler,
	type MapQueryResult,
	type Patch,
	Prettify,
	processConnectionOptions,
	ScopeAuth,
	Token,
	TransformAuth,
} from "./types.ts";
import { ConnectionStatus } from "./library/engine.ts";
import config from "./config.ts";
import { flatten } from "./library/flatten.ts";

type Engines = Record<string, new (emitter: Emitter<EngineEvents>) => Engine>;
type R = Prettify<Record<string, unknown>>;

export class Surreal {
	public connection: Engine | undefined;
	private pinger?: Pinger;
	ready?: Promise<void>;
	emitter: Emitter<EngineEvents>;
	protected engines: Engines = {
		ws: WebsocketEngine,
		wss: WebsocketEngine,
		http: HttpEngine,
		https: HttpEngine,
	};

	/**
	 * Constructs a new instance of the SurrealDB client with optional configurations.
	 *
	 * 	 @param {Object} options - The options for configuring the instance.
	 *   @param {Engines} [options.engines] - Engines to be integrated within the class.
	 *   @param {boolean} [options.flatMode=false] - If true, flatten SurrealDB responses into Plain Javascript Objects.
	 */
	constructor({
		engines,
		flatMode = false,
	}: {
		engines?: Engines;
		flatMode?: boolean;
	} = {}) {
		this.emitter = new Emitter();
		this.emitter.subscribe("disconnected", () => this.clean());
		this.emitter.subscribe("error", () => this.close());
		config.flatMode = flatMode;

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
	async connect(url: string | URL, opts: ConnectionOptions = {}) {
		url = new URL(url);
		url.pathname = "/rpc";
		const engineName = url.protocol.slice(0, -1);
		const engine = this.engines[engineName];
		if (!engine) throw new UnsupportedEngine(engineName);

		const { prepare, auth, namespace, database } = processConnectionOptions(
			opts,
		);

		// Close any existing connections
		await this.close();

		// The promise does not know if `this.connection` is undefined or not, but it does about `connection`
		const connection = new engine(this.emitter);

		this.connection = connection;
		this.pinger = new Pinger(30000);

		this.ready = new Promise((resolve, reject) =>
			connection
				.connect(url as URL)
				.then(async () => {
					this.pinger?.start(() => this.ping());
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
				.catch(reject)
		);

		return this.ready;
	}

	/**
	 * Disconnect the socket to the database
	 */
	async close() {
		this.clean();
		const queue: Promise<unknown>[] = [];
		if (this.connection) {
			if (this.connection.status != ConnectionStatus.Disconnected) {
				queue.push(this.emitter.subscribeOnce("disconnected"));
			}

			queue.push(this.connection?.disconnect());
		}

		await Promise.all(queue);
	}

	private clean() {
		this.pinger?.stop();

		// Scan all pending rpc requests
		const pending = this.emitter.scanListeners((k) => k.startsWith("rpc-"));

		// Ensure all rpc requests get a connection closed response
		pending.map((k) => this.emitter.emit(k, [new EngineDisconnected()]));

		// Cleanup subscriptions and yet to be collected emisions
		this.emitter.reset({
			collectable: true,
			listeners: pending,
		});
	}

	/**
	 * Check if connection is ready
	 */
	get status() {
		return this.connection?.status;
	}

	/**
	 * Ping SurrealDB instance
	 */
	async ping() {
		const { error } = await this.rpc("ping");
		if (error) throw new ResponseError(error.message);
	}

	/**
	 * Switch to a specific namespace and database.
	 * @param database - Switches to a specific namespace.
	 * @param db - Switches to a specific database.
	 */
	async use(
		{ namespace, database }: { namespace?: string; database?: string },
	) {
		if (!this.connection) throw new NoActiveSocket();

		if (!namespace && !this.connection.connection.namespace) {
			throw new NoNamespaceSpecified();
		}
		if (!database && !this.connection.connection.database) {
			throw new NoDatabaseSpecified();
		}

		const { error } = await this.rpc("use", [
			namespace ?? this.connection.connection.namespace,
			database ?? this.connection.connection.database,
		]);

		if (error) throw new ResponseError(error.message);
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
		if (config.flatMode === true) return flatten(res.result) ?? undefined;
		return res.result ?? undefined;
	}

	/**
	 * Signs up to a specific authentication scope.
	 * @param vars - Variables used in a signup query.
	 * @return The authentication token.
	 */
	async signup(vars: ScopeAuth) {
		if (!this.connection) throw new NoActiveSocket();

		vars = ScopeAuth.parse(vars);
		vars = processAuthVars(vars, this.connection.connection);

		const res = await this.rpc<string>("signup", [
			TransformAuth.parse(vars),
		]);
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
	async signin(vars: AnyAuth) {
		if (!this.connection) throw new NoActiveSocket();

		vars = AnyAuth.parse(vars);
		vars = processAuthVars(vars, this.connection.connection);

		const res = await this.rpc<string>("signin", [
			TransformAuth.parse(vars),
		]);
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
	async authenticate(token: Token) {
		const res = await this.rpc<string>("authenticate", [
			Token.parse(token),
		]);
		if (res.error) throw new ResponseError(res.error.message);
		return true;
	}

	/**
	 * Invalidates the authentication for the current connection.
	 */
	async invalidate() {
		const res = await this.rpc("invalidate");
		if (res.error) throw new ResponseError(res.error.message);
		return true;
	}

	/**
	 * Specify a variable for the current socket connection.
	 * @param key - Specifies the name of the variable.
	 * @param val - Assigns the value to the variable name.
	 */
	async let(variable: string, value: unknown) {
		const res = await this.rpc("let", [variable, value]);
		if (res.error) throw new ResponseError(res.error.message);
		return true;
	}

	/**
	 * Remove a variable from the current socket connection.
	 * @param key - Specifies the name of the variable.
	 */
	async unset(variable: string) {
		const res = await this.rpc("unset", [variable]);
		if (res.error) throw new ResponseError(res.error.message);
	}

	/**
	 * Start a live query and listen for the responses
	 * @param table - The table that you want to receive live results for.
	 * @param callback - Callback function that receives updates.
	 * @param diff - If set to true, will return a set of patches instead of complete records
	 */
	async live<
		Result extends Record<string, unknown> | Patch = Record<
			string,
			unknown
		>,
	>(
		table: string,
		callback?: LiveHandler<Result>,
		diff?: boolean,
	) {
		await this.ready;
		const res = await this.rpc<UUID>("live", [table, diff]);

		if (res.error) throw new ResponseError(res.error.message);
		if (callback) this.subscribeLive<Result>(res.result, callback);

		return res.result;
	}

	/**
	 * Listen for live query responses by it's uuid
	 * @param queryUuid - The LQ uuid that you want to receive live results for.
	 * @param callback - Callback function that receives updates.
	 */
	async subscribeLive<
		Result extends Record<string, unknown> | Patch = Record<
			string,
			unknown
		>,
	>(
		queryUuid: UUID,
		callback: LiveHandler<Result>,
	) {
		await this.ready;
		if (!this.connection) throw new NoActiveSocket();
		this.connection.emitter.subscribe(
			`live-${queryUuid}`,
			callback as (
				action: Action,
				result: Record<string, unknown> | Patch,
			) => unknown,
			true,
		);
	}

	/**
	 * Listen for live query responses by it's uuid
	 * @param queryUuid - The LQ uuid that you want to receive live results for.
	 * @param callback - Callback function that receives updates.
	 */
	async unSubscribeLive<
		Result extends Record<string, unknown> | Patch = Record<
			string,
			unknown
		>,
	>(
		queryUuid: UUID,
		callback: LiveHandler<Result>,
	) {
		await this.ready;
		if (!this.connection) throw new NoActiveSocket();
		this.connection.emitter.unSubscribe(
			`live-${queryUuid}`,
			callback as (
				action: Action,
				result: Record<string, unknown> | Patch,
			) => unknown,
		);
	}

	/**
	 * Kill a live query
	 * @param queryUuid - The query that you want to kill.
	 */
	async kill(queryUuid: UUID | readonly UUID[]) {
		await this.ready;
		if (!this.connection) throw new NoActiveSocket();
		if (Array.isArray(queryUuid)) {
			await Promise.all(queryUuid.map((u) => this.rpc("kill", [u])));
			const toBeKilled = queryUuid.map((u) => `live-${u}` as const);
			this.connection.emitter.reset({
				collectable: toBeKilled,
				listeners: toBeKilled,
			});
		} else {
			await this.rpc("kill", [queryUuid]);
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
		query: string | PreparedQuery,
		bindings?: Record<string, unknown>,
	) {
		const raw = await this.query_raw<T>(query, bindings);
		return raw.map(({ status, result }) => {
			if (status == "ERR") throw new ResponseError(result);
			if (config.flatMode === true) return flatten(result);
			return result;
		});
	}

	/**
	 * Runs a set of SurrealQL statements against the database.
	 * @param query - Specifies the SurrealQL statements.
	 * @param bindings - Assigns variables which can be used in the query.
	 */
	async query_raw<T extends unknown[]>(
		query: string | PreparedQuery,
		bindings?: Record<string, unknown>,
	) {
		if (typeof query !== "string") {
			bindings = bindings ?? {};
			bindings = { ...bindings, ...query.bindings };
			query = query.query;
		}

		await this.ready;
		const res = await this.rpc<MapQueryResult<T>>("query", [
			query,
			bindings,
		]);
		if (res.error) throw new ResponseError(res.error.message);
		if (config.flatMode === true) return flatten(res.result);
		return res.result;
	}

	/**
	 * Selects all records in a table, or a specific record, from the database.
	 * @param thing - The table name or a record ID to select.
	 */
	async select<T extends R>(thing: string): Promise<ActionResult<T>[]>;
	async select<T extends R>(thing: RecordId): Promise<ActionResult<T>>;
	async select<T extends R>(thing: RecordId | string) {
		await this.ready;
		const res = await this.rpc<ActionResult<T>>("select", [thing]);
		if (res.error) throw new ResponseError(res.error.message);
		if (config.flatMode === true) return flatten(res.result);
		return res.result;
	}

	/**
	 * Creates a record in the database.
	 * @param thing - The table name or the specific record ID to create.
	 * @param data - The document / record data to insert.
	 */
	async create<T extends R, U extends R = T>(
		thing: string,
		data?: U,
	): Promise<ActionResult<T>[]>;
	async create<T extends R, U extends R = T>(
		thing: RecordId,
		data?: U,
	): Promise<ActionResult<T>>;
	async create<T extends R, U extends R = T>(
		thing: RecordId | string,
		data?: U,
	) {
		await this.ready;
		const res = await this.rpc<ActionResult<T>>("create", [thing, data]);
		if (res.error) throw new ResponseError(res.error.message);
		if (config.flatMode === true) return flatten(res.result);
		return res.result;
	}

	/**
	 * Inserts one or multiple records in the database.
	 * @param thing - The table name or the specific record ID to create.
	 * @param data - The document(s) / record(s) to insert.
	 */
	async insert<T extends R, U extends R = T>(
		thing: string,
		data?: U | U[],
	): Promise<ActionResult<T>[]>;
	async insert<T extends R, U extends R = T>(
		thing: RecordId,
		data?: U,
	): Promise<ActionResult<T>>;
	async insert<T extends R, U extends R = T>(
		thing: RecordId | string,
		data?: U | U[],
	) {
		await this.ready;
		const res = await this.rpc<ActionResult<T>>("insert", [thing, data]);
		if (res.error) throw new ResponseError(res.error.message);
		if (config.flatMode === true) return flatten(res.result);
		return res.result;
	}

	/**
	 * Updates all records in a table, or a specific record, in the database.
	 *
	 * ***NOTE: This function replaces the current document / record data with the specified data.***
	 * @param thing - The table name or the specific record ID to update.
	 * @param data - The document / record data to insert.
	 */
	async update<T extends R, U extends R = T>(
		thing: string,
		data?: U,
	): Promise<ActionResult<T>[]>;
	async update<T extends R, U extends R = T>(
		thing: RecordId,
		data?: U,
	): Promise<ActionResult<T>>;
	async update<T extends R, U extends R = T>(
		thing: RecordId | string,
		data?: U,
	) {
		await this.ready;
		const res = await this.rpc<ActionResult<T>>("update", [thing, data]);
		if (res.error) throw new ResponseError(res.error.message);
		if (config.flatMode === true) return flatten(res.result);
		return res.result;
	}

	/**
	 * Modifies all records in a table, or a specific record, in the database.
	 *
	 * ***NOTE: This function merges the current document / record data with the specified data.***
	 * @param thing - The table name or the specific record ID to change.
	 * @param data - The document / record data to insert.
	 */
	async merge<T extends R, U extends R = Partial<T>>(
		thing: string,
		data?: U,
	): Promise<ActionResult<T>[]>;
	async merge<T extends R, U extends R = Partial<T>>(
		thing: RecordId,
		data?: U,
	): Promise<ActionResult<T>>;
	async merge<T extends R, U extends R = Partial<T>>(
		thing: RecordId | string,
		data?: U,
	) {
		await this.ready;
		const res = await this.rpc<ActionResult<T>>("merge", [thing, data]);
		if (res.error) throw new ResponseError(res.error.message);
		if (config.flatMode === true) return flatten(res.result);
		return res.result;
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
		thing: string,
		data?: Patch[],
		diff?: false,
	): Promise<ActionResult<T>[]>;
	async patch<T extends R>(
		thing: RecordId,
		data: undefined | Patch[],
		diff: true,
	): Promise<Patch[]>;
	async patch<T extends R>(
		thing: string,
		data: undefined | Patch[],
		diff: true,
	): Promise<Patch[][]>;
	async patch(thing: RecordId | string, data?: Patch[], diff?: boolean) {
		await this.ready;
		// deno-lint-ignore no-explicit-any
		const res = await this.rpc<any>("patch", [thing, data, diff]);
		if (res.error) throw new ResponseError(res.error.message);
		if (config.flatMode === true) return flatten(res.result);
		return res.result;
	}

	/**
	 * Deletes all records in a table, or a specific record, from the database.
	 * @param thing - The table name or a record ID to select.
	 */
	async delete<T extends R>(thing: string): Promise<ActionResult<T>[]>;
	async delete<T extends R>(thing: RecordId): Promise<ActionResult<T>>;
	async delete<T extends R>(thing: RecordId | string) {
		await this.ready;
		const res = await this.rpc<ActionResult<T>>("delete", [thing]);
		if (res.error) throw new ResponseError(res.error.message);
		if (config.flatMode === true) return flatten(res.result);
		return res.result;
	}

	/**
	 * Send a raw message to the SurrealDB instance
	 * @param method - Type of message to send.
	 * @param params - Parameters for the message.
	 */
	protected rpc<Result extends unknown>(method: string, params?: unknown[]) {
		if (!this.connection) throw new NoActiveSocket();
		return this.connection.rpc<typeof method, typeof params, Result>({
			method,
			params,
		});
	}
}
