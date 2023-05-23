import { NoActiveSocket, UnexpectedResponse } from "../errors.ts";
import { Pinger } from "../library/Pinger.ts";
import { SurrealSocket } from "../library/SurrealSocket.ts";
import {
	type AnyAuth,
	type Connection,
	type ConnectionOptions,
	type LiveQueryResponse,
	type MapQueryResult,
	type MergeData,
	type Patch,
	type RawQueryResult,
	type Result,
	type ScopeAuth,
	type Token,
} from "../types.ts";

export class WebSocketStrategy implements Connection {
	protected socket?: SurrealSocket;
	private pinger?: Pinger;
	private connection: {
		ns?: string;
		db?: string;
		auth?: AnyAuth | Token;
	} = {};

	public ready: Promise<void>;
	private resolveReady: () => void;

	/**
	 * Establish a socket connection to the database
	 * @param connection - Connection details
	 */
	constructor(url?: string, options: ConnectionOptions = {}) {
		this.resolveReady = () => {}; // Purely for typescript typing :)
		this.ready = new Promise((r) => (this.resolveReady = r));
		if (url) this.connect(url, options);
	}

	/**
	 * Establish a socket connection to the database
	 * @param connection - Connection details
	 */
	connect(url: string, { prepare, auth, ns, db }: ConnectionOptions = {}) {
		this.connection = {
			auth,
			ns,
			db,
		};

		this.socket?.close(1000);
		this.pinger = new Pinger(30000);
		this.socket = new SurrealSocket({
			url,
			onOpen: async () => {
				this.pinger?.start(() => this.ping());
				if (this.connection.ns && this.connection.db) {
					await this.use({});
				}
				if (typeof this.connection.auth === "string") {
					await this.authenticate(this.connection.auth);
				} else if (this.connection.auth) {
					await this.signin(this.connection.auth);
				}

				await prepare?.(this);
				this.resolveReady();
			},
			onClose: () => {
				this.pinger?.stop();
				this.resetReady();
			},
		});

		this.socket.open();
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
	async use({ ns, db }: { ns?: string; db?: string }) {
		if (!ns && !this.connection.ns) {
			throw new Error("Please specify a namespace to use.");
		}
		if (!db && !this.connection.db) {
			throw new Error("Please specify a database to use.");
		}
		this.connection.ns = ns ?? this.connection.ns;
		this.connection.db = db ?? this.connection.db;
		const { error } = await this.send("use", [
			this.connection.ns,
			this.connection.db,
		]);
		if (error) throw new Error(error.message);
	}

	/**
	 * Retrieve info about the current Surreal instance
	 * @return Returns nothing!
	 */
	async info() {
		const res = await this.send("info");
		if (res.error) throw new Error(res.error.message);
	}

	/**
	 * Signs up to a specific authentication scope.
	 * @param vars - Variables used in a signup query.
	 * @return The authentication token.
	 */
	async signup(vars: ScopeAuth) {
		const res = await this.send<string>("signup", [vars]);
		if (res.error) throw new Error(res.error.message);
		this.connection.auth = res.result;
		return res.result;
	}

	/**
	 * Signs in to a specific authentication scope.
	 * @param vars - Variables used in a signin query.
	 * @return The authentication token.
	 */
	async signin(vars: AnyAuth) {
		const res = await this.send<string | undefined>("signin", [vars]);
		if (res.error) throw new Error(res.error.message);
		this.connection.auth = res.result ?? vars;
		return res.result;
	}

	/**
	 * Authenticates the current connection with a JWT token.
	 * @param token - The JWT authentication token.
	 */
	async authenticate(token: Token) {
		const res = await this.send<string>("authenticate", [token]);
		if (res.error) throw new Error(res.error.message);
		this.connection.auth = token;
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
	 * @param query - The query that you want to receive live results for.
	 * @param callback - Callback function that receives updates.
	 */
	async live<T extends Record<string, unknown> = Record<string, unknown>>(
		query: string,
		callback?: (data: LiveQueryResponse<T>) => unknown,
	) {
		await this.ready;
		const res = await this.send<string>("live", [query]);
		if (res.error) throw new Error(res.error.message);
		if (callback) this.listenLive<T>(res.result, callback);
		return res.result;
	}

	/**
	 * Listen for live query responses by it's uuid
	 * @param uuid - The LQ uuid that you want to receive live results for.
	 * @param callback - Callback function that receives updates.
	 */
	async listenLive<
		T extends Record<string, unknown> = Record<string, unknown>,
	>(
		uuid: string,
		callback: (data: LiveQueryResponse<T>) => unknown,
	) {
		await this.ready;
		if (!this.socket) throw new NoActiveSocket();
		this.socket.listenLive(
			uuid,
			callback as (data: LiveQueryResponse) => unknown,
		);
	}

	/**
	 * Kill a live query
	 * @param uuid - The query that you want to kill.
	 */
	async kill(uuid: string) {
		await this.ready;
		if (!this.socket) throw new NoActiveSocket();
		await this.socket.kill(uuid);
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
		const res = await this.send<T & { id: string }>("select", [thing]);
		return this.outputHandler(res);
	}

	/**
	 * Creates a record in the database.
	 * @param thing - The table name or the specific record ID to create.
	 * @param data - The document / record data to insert.
	 */
	async create<T extends Record<string, unknown>>(thing: string, data?: T) {
		await this.ready;
		const res = await this.send<T & { id: string }>("create", [
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
	async update<T extends Record<string, unknown>>(thing: string, data?: T) {
		await this.ready;
		const res = await this.send<T & { id: string }>("update", [
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
		U extends Record<string, unknown> = T,
	>(thing: string, data?: MergeData<T, U>) {
		await this.ready;
		const res = await this.send<MergeData<T, U> & { id: string }>("merge", [
			thing,
			data,
		]);
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
		const res = await this.send<T & { id: string }>("delete", [thing]);
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

	/**
	 * Reset the ready mechanism.
	 */
	private resetReady() {
		this.ready = new Promise((r) => (this.resolveReady = r));
	}
}
