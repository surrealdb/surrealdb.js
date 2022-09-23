// deno-lint-ignore-file no-explicit-any
import guid from "./utils/guid.ts";
import errors from "./errors/index.ts";
import Live from "./classes/live.ts";
import Socket from "./classes/socket.ts";
import Pinger from "./classes/pinger.ts";
import Emitter from "./classes/emitter.ts";

let singleton: Surreal;

interface BasePatch {
	path: string;
}

export interface AddPatch extends BasePatch {
	op: "add";
	value: any;
}

export interface RemovePatch extends BasePatch {
	op: "remove";
}

export interface ReplacePatch extends BasePatch {
	op: "replace";
	value: any;
}

export interface ChangePatch extends BasePatch {
	op: "change";
	value: string;
}

export type Patch =
	| AddPatch
	| RemovePatch
	| ReplacePatch
	| ChangePatch;

interface ResultOk<T> {
	result: T;
	error?: never;
}

interface ResultErr {
	result?: never;
	error: Error;
}

export type Result<T = unknown> = ResultOk<T> | ResultErr;

export interface RootAuth {
	user: string;
	pass: string;
}

export interface NamespaceAuth {
	NS: string;
	user: string;
	pass: string;
}

export interface DatabaseAuth {
	NS: string;
	DB: string;
	user: string;
	pass: string;
}

export interface ScopeAuth {
	NS: string;
	DB: string;
	SC: string;
	[key: string]: unknown;
}

export type Auth =
	| RootAuth
	| NamespaceAuth
	| DatabaseAuth
	| ScopeAuth;

export default class Surreal extends Emitter<
	& {
		open: [];
		opened: [];
		close: [];
		closed: [];
		notify: [any];
	}
	& {
		[
			K in Exclude<
				string,
				"open" | "opened" | "close" | "closed" | "notify"
			>
		]: [any];
	}
> {
	// ------------------------------
	// Main singleton
	// ------------------------------

	/**
	 * The Instance static singleton ensures that a single database instance is available across very large or complicated applications.
	 * With the singleton, only one connection to the database is instantiated, and the database connection does not have to be shared
	 * across components or controllers.
	 * @return A Surreal instance.
	 */
	static get Instance(): Surreal {
		return singleton ? singleton : singleton = new Surreal();
	}

	// ------------------------------
	// Public types
	// ------------------------------

	static get AuthenticationError(): typeof errors.AuthenticationError {
		return errors.AuthenticationError;
	}

	static get PermissionError(): typeof errors.PermissionError {
		return errors.PermissionError;
	}

	static get RecordError(): typeof errors.RecordError {
		return errors.RecordError;
	}

	static get Live(): typeof Live {
		return Live;
	}

	// ------------------------------
	// Properties
	// ------------------------------

	#ws!: Socket;

	#url?: string;

	#token?: string;

	#pinger!: Pinger;

	#attempted?: Promise<void>;

	// ------------------------------
	// Accessors
	// ------------------------------

	get token(): string | undefined {
		return this.#token;
	}

	set token(token) {
		this.#token = token;
	}

	// ------------------------------
	// Methods
	// ------------------------------

	/**
	 * Initializee a SurrealDb.
	 * @param url - The url of the database endpoint to connect to.
	 * @param token - The authorization token.
	 */
	constructor(url?: string, token?: string) {
		super();

		this.#url = url;

		this.#token = token;

		if (url) {
			this.connect(url);
		}
	}

	/**
	 * Connects to a local or remote database endpoint.
	 * @param url - The url of the database endpoint to connect to.
	 */
	connect(url: string): Promise<void> {
		// Next we setup the websocket connection
		// and listen for events on the socket,
		// specifying whether logging is enabled.

		this.#ws = new Socket(url);

		// Setup the interval pinger so that the
		// connection is kept alive through
		// loadbalancers and proxies.

		this.#pinger = new Pinger(30000);

		// When the connection is opened we
		// need to attempt authentication if
		// a token has already been applied.

		this.#ws.on("open", () => {
			this.#init();
		});

		// When the connection is opened we
		// change the relevant properties
		// open live queries, and trigger.

		this.#ws.on("open", () => {
			this.emit("open");
			this.emit("opened");

			this.#pinger.start(() => {
				this.ping();
			});
		});

		// When the connection is closed we
		// change the relevant properties
		// stop live queries, and trigger.

		this.#ws.on("close", () => {
			this.emit("close");
			this.emit("closed");

			this.#pinger.stop();
		});

		// When we receive a socket message
		// we process it. If it has an ID
		// then it is a query response.

		this.#ws.on("message", (e) => {
			const d = JSON.parse(e.data);

			if (d.method !== "notify") {
				return this.emit(d.id, d);
			}

			if (d.method === "notify") {
				return d.params.forEach((r: undefined) => {
					this.emit("notify", r);
				});
			}
		});

		// Open the websocket for the first
		// time. This will automatically
		// attempt to reconnect on failure.

		this.#ws.open();

		//
		//
		//

		return this.wait();
	}

	// --------------------------------------------------
	// Public methods
	// --------------------------------------------------

	sync(query: string, vars?: Record<string, unknown>): Live {
		return new Live(this, query, vars);
	}

	/**
	 * Waits for the connection to the database to succeed.
	 */
	wait(): Promise<void> {
		return this.#ws.ready.then(() => {
			return this.#attempted!;
		});
	}

	/**
	 * Closes the persistent connection to the database.
	 */
	close(): void {
		this.#ws.close();
	}

	// --------------------------------------------------

	/**
	 * Ping SurrealDB instance
	 */
	ping(): Promise<void> {
		const id = guid();
		return this.#ws.ready.then(() => {
			return new Promise(() => {
				this.#send(id, "ping");
			});
		});
	}

	/**
	 * Switch to a specific namespace and database.
	 * @param ns - Switches to a specific namespace.
	 * @param db - Switches to a specific database.
	 */
	use(ns: string, db: string): Promise<void> {
		const id = guid();
		return this.#ws.ready.then(() => {
			return new Promise((resolve, reject) => {
				this.once(id, (res) => this.#result(res, resolve, reject));
				this.#send(id, "use", [ns, db]);
			});
		});
	}

	/**
	 * Retreive info about the current Surreal instance
	 * @return Returns nothing!
	 */
	info(): Promise<void> {
		const id = guid();
		return this.#ws.ready.then(() => {
			return new Promise((resolve, reject) => {
				this.once(id, (res) => this.#result(res, resolve, reject));
				this.#send(id, "info");
			});
		});
	}

	/**
	 * Signs up to a specific authentication scope.
	 * @param vars - Variables used in a signup query.
	 * @return The authenication token.
	 */
	signup(vars: Auth): Promise<string> {
		const id = guid();
		return this.#ws.ready.then(() => {
			return new Promise((resolve, reject) => {
				this.once(id, (res) => this.#signup(res, resolve, reject));
				this.#send(id, "signup", [vars]);
			});
		});
	}

	/**
	 * Signs in to a specific authentication scope.
	 * @param vars - Variables used in a signin query.
	 * @return The authenication token.
	 */
	signin(vars: Auth): Promise<string> {
		const id = guid();
		return this.#ws.ready.then(() => {
			return new Promise((resolve, reject) => {
				this.once(id, (res) => this.#signin(res, resolve, reject));
				this.#send(id, "signin", [vars]);
			});
		});
	}

	/**
	 * Invalidates the authentication for the current connection.
	 */
	invalidate(): Promise<void> {
		const id = guid();
		return this.#ws.ready.then(() => {
			return new Promise((resolve, reject) => {
				this.once(id, (res) => this.#auth(res, resolve, reject));
				this.#send(id, "invalidate");
			});
		});
	}

	/**
	 * Authenticates the current connection with a JWT token.
	 * @param token - The JWT authentication token.
	 */
	authenticate(token: string): Promise<void> {
		const id = guid();
		return this.#ws.ready.then(() => {
			return new Promise<unknown>((resolve, reject) => {
				this.once(id, (res) => this.#auth(res, resolve, reject));
				this.#send(id, "authenticate", [token]);
			}) as Promise<void>;
		});
	}

	// --------------------------------------------------

	live(table: string): Promise<string> {
		const id = guid();
		return this.wait().then(() => {
			return new Promise((resolve, reject) => {
				this.once(id, (res) => this.#result(res, resolve, reject));
				this.#send(id, "live", [table]);
			});
		});
	}

	/**
	 * Kill a specific query.
	 * @param query - The query to kill.
	 */
	kill(query: string): Promise<void> {
		const id = guid();
		return this.wait().then(() => {
			return new Promise((resolve, reject) => {
				this.once(id, (res) => this.#result(res, resolve, reject));
				this.#send(id, "kill", [query]);
			});
		});
	}

	/**
	 * Switch to a specific namespace and database.
	 * @param key - Specifies the name of the variable.
	 * @param val - Assigns the value to the variable name.
	 */
	let(key: string, val: unknown): Promise<string> {
		const id = guid();
		return this.wait().then(() => {
			return new Promise((resolve, reject) => {
				this.once(id, (res) => this.#result(res, resolve, reject));
				this.#send(id, "let", [key, val]);
			});
		});
	}

	/**
	 * Runs a set of SurrealQL statements against the database.
	 * @param query - Specifies the SurrealQL statements.
	 * @param vars - Assigns variables which can be used in the query.
	 */
	query<T = Result[]>(
		query: string,
		vars?: Record<string, unknown>,
	): Promise<T> {
		const id = guid();
		return this.wait().then(() => {
			return new Promise<T>((resolve, reject) => {
				this.once(
					id,
					(res) => this.#result(res, resolve as () => void, reject),
				);
				this.#send(id, "query", [query, vars]);
			});
		});
	}

	/**
	 * Selects all records in a table, or a specific record, from the database.
	 * @param thing - The table name or a record ID to select.
	 */
	select<T>(thing: string): Promise<T[]> {
		const id = guid();
		return this.wait().then(() => {
			return new Promise((resolve, reject) => {
				this.once(
					id,
					(res) =>
						this.#output(res, "select", thing, resolve, reject),
				);
				this.#send(id, "select", [thing]);
			});
		});
	}

	/**
	 * Creates a record in the database.
	 * @param thing - The table name or the specific record ID to create.
	 * @param data - The document / record data to insert.
	 */
	create<T extends Record<string, unknown>>(
		thing: string,
		data?: T,
	): Promise<T & { id: string }> {
		const id = guid();
		return this.wait().then(() => {
			return new Promise((resolve, reject) => {
				this.once(
					id,
					(res) =>
						this.#output(res, "create", thing, resolve, reject),
				);
				this.#send(id, "create", [thing, data]);
			});
		});
	}

	/**
	 * Updates all records in a table, or a specific record, in the database.
	 *
	 * ***NOTE: This function replaces the current document / record data with the specified data.***
	 * @param thing - The table name or the specific record ID to update.
	 * @param data - The document / record data to insert.
	 */
	update<T extends Record<string, unknown>>(
		thing: string,
		data?: T,
	): Promise<T & { id: string }> {
		const id = guid();
		return this.wait().then(() => {
			return new Promise((resolve, reject) => {
				this.once(
					id,
					(res) =>
						this.#output(res, "update", thing, resolve, reject),
				);
				this.#send(id, "update", [thing, data]);
			});
		});
	}

	/**
	 * Modifies all records in a table, or a specific record, in the database.
	 *
	 * ***NOTE: This function merges the current document / record data with the specified data.***
	 * @param thing - The table name or the specific record ID to change.
	 * @param data - The document / record data to insert.
	 */
	change<
		T extends Record<string, unknown>,
		U extends Record<string, unknown> = T,
	>(
		thing: string,
		data?: Partial<T> & U,
	): Promise<(T & U & { id: string }) | (T & U & { id: string })[]> {
		const id = guid();
		return this.wait().then(() => {
			return new Promise((resolve, reject) => {
				this.once(
					id,
					(res) =>
						this.#output(res, "change", thing, resolve, reject),
				);
				this.#send(id, "change", [thing, data]);
			});
		});
	}

	/**
	 * Applies JSON Patch changes to all records, or a specific record, in the database.
	 *
	 * ***NOTE: This function patches the current document / record data with the specified JSON Patch data.***
	 * @param thing - The table name or the specific record ID to modify.
	 * @param data - The JSON Patch data with which to modify the records.
	 */
	modify(thing: string, data?: Patch[]): Promise<Patch[]> {
		const id = guid();
		return this.wait().then(() => {
			return new Promise((resolve, reject) => {
				this.once(
					id,
					(res) =>
						this.#output(res, "modify", thing, resolve, reject),
				);
				this.#send(id, "modify", [thing, data]);
			});
		});
	}

	/**
	 * Deletes all records in a table, or a specific record, from the database.
	 * @param thing - The table name or a record ID to select.
	 */
	delete(thing: string): Promise<void> {
		const id = guid();
		return this.wait().then(() => {
			return new Promise((resolve, reject) => {
				this.once(
					id,
					(res) =>
						this.#output(res, "delete", thing, resolve, reject),
				);
				this.#send(id, "delete", [thing]);
			});
		});
	}

	// --------------------------------------------------
	// Private methods
	// --------------------------------------------------

	#init(): void {
		this.#attempted = new Promise((res) => {
			this.#token
				? this.authenticate(this.#token).then(res).catch(res)
				: res();
		});
	}

	#send(id: string, method: string, params: unknown[] = []): void {
		this.#ws.send(JSON.stringify({
			id: id,
			method: method,
			params: params,
		}));
	}

	#auth<T>(
		res: Result<T>,
		resolve: (value: T) => void,
		reject: (reason?: any) => void,
	): void {
		if (res.error) {
			return reject(new Surreal.AuthenticationError(res.error.message));
		} else {
			return resolve(res.result);
		}
	}

	#signin(
		res: Result<string>,
		resolve: (value: string) => void,
		reject: (reason?: any) => void,
	): void {
		if (res.error) {
			return reject(new Surreal.AuthenticationError(res.error.message));
		} else {
			this.#token = res.result;
			return resolve(res.result);
		}
	}

	#signup(
		res: Result<string>,
		resolve: (value: string) => void,
		reject: (reason?: any) => void,
	): void {
		if (res.error) {
			return reject(new Surreal.AuthenticationError(res.error.message));
		} else if (res.result) {
			this.#token = res.result;
			return resolve(res.result);
		}
	}

	#result<T>(
		res: Result<T>,
		resolve: (value: T) => void,
		reject: (reason?: any) => void,
	): void {
		if (res.error) {
			return reject(new Error(res.error.message));
		} else if (res.result) {
			return resolve(res.result);
		}
		return resolve(undefined as unknown as T);
	}

	#output<T>(
		res: Result<T>,
		type: string,
		id: string,
		resolve: (value: T) => void,
		reject: (reason?: any) => void,
	): void {
		if (res.error) {
			return reject(new Error(res.error.message));
		} else if (res.result) {
			switch (type) {
				case "delete":
					return resolve(undefined as unknown as T);
				case "create":
					return Array.isArray(res.result) && res.result.length
						? resolve(res.result[0])
						: reject(
							new Surreal.PermissionError(
								`Unable to create record: ${id}`,
							),
						);
				case "update":
					if (typeof id === "string" && id.includes(":")) {
						return Array.isArray(res.result) && res.result.length
							? resolve(res.result[0])
							: reject(
								new Surreal.PermissionError(
									`Unable to update record: ${id}`,
								),
							);
					} else {
						return resolve(res.result);
					}
				case "change":
					if (typeof id === "string" && id.includes(":")) {
						return Array.isArray(res.result) && res.result.length
							? resolve(res.result[0])
							: reject(
								new Surreal.PermissionError(
									`Unable to update record: ${id}`,
								),
							);
					} else {
						return resolve(res.result);
					}
				case "modify":
					if (typeof id === "string" && id.includes(":")) {
						return Array.isArray(res.result) && res.result.length
							? resolve(res.result[0])
							: reject(
								new Surreal.PermissionError(
									`Unable to update record: ${id}`,
								),
							);
					} else {
						return resolve(res.result);
					}
				default:
					if (typeof id === "string" && id.includes(":")) {
						return Array.isArray(res.result) && res.result.length
							? resolve(res.result)
							: reject(
								new Surreal.RecordError(
									`Record not found: ${id}`,
								),
							);
					} else {
						return resolve(res.result);
					}
			}
		}
		return resolve(undefined as unknown as T);
	}
}
