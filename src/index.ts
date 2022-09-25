import guid from "./utils/guid.ts";
import {
	AuthenticationError,
	PermissionError,
	RecordError,
} from "./errors/index.ts";
import Live from "./classes/live.ts";
import Socket from "./classes/socket.ts";
import Pinger from "./classes/pinger.ts";
import Emitter from "./classes/emitter.ts";
import type { EventMap, EventName } from "./classes/emitter.ts";

export { Emitter, Live };
export type { EventMap, EventName };

let singleton: Surreal;

export interface BasePatch {
	path: string;
}

export interface AddPatch extends BasePatch {
	op: "add";
	// deno-lint-ignore no-explicit-any
	value: any;
}

export interface RemovePatch extends BasePatch {
	op: "remove";
}

export interface ReplacePatch extends BasePatch {
	op: "replace";
	// deno-lint-ignore no-explicit-any
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

interface SurrealBaseEventMap {
	open: [];
	opened: [];
	close: [];
	closed: [];
	// deno-lint-ignore no-explicit-any
	notify: [any];
}

export default class Surreal extends Emitter<
	& SurrealBaseEventMap
	& {
		[
			K in Exclude<
				EventName,
				keyof SurrealBaseEventMap
			>
			// deno-lint-ignore no-explicit-any
		]: [Result<any>];
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

	static get AuthenticationError(): typeof AuthenticationError {
		return AuthenticationError;
	}

	static get PermissionError(): typeof PermissionError {
		return PermissionError;
	}

	static get RecordError(): typeof RecordError {
		return RecordError;
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
	async ping(): Promise<void> {
		const id = guid();
		await this.#ws.ready;
		this.#send(id, "ping");
	}

	/**
	 * Switch to a specific namespace and database.
	 * @param ns - Switches to a specific namespace.
	 * @param db - Switches to a specific database.
	 */
	async use(ns: string, db: string): Promise<void> {
		const id = guid();

		await this.#ws.ready;

		this.#send(id, "use", [ns, db]);

		const [res] = await this.nextEvent(id);

		if (res.error) throw new Error(res.error.message);

		return res.result;
	}

	/**
	 * Retreive info about the current Surreal instance
	 * @return Returns nothing!
	 */
	async info(): Promise<void> {
		const id = guid();

		await this.#ws.ready;
		this.#send(id, "info");

		const [res] = await this.nextEvent(id);

		if (res.error) throw new Error(res.error.message);

		return res.result;
	}

	/**
	 * Signs up to a specific authentication scope.
	 * @param vars - Variables used in a signup query.
	 * @return The authenication token.
	 */
	async signup(vars: Auth): Promise<string> {
		const id = guid();

		await this.#ws.ready;
		this.#send(id, "signup", [vars]);

		const [res] = await this.nextEvent(id);

		if (res.error) throw new AuthenticationError(res.error.message);

		this.#token = res.result;
		return res.result;
	}

	/**
	 * Signs in to a specific authentication scope.
	 * @param vars - Variables used in a signin query.
	 * @return The authenication token.
	 */
	async signin(vars: Auth): Promise<string> {
		const id = guid();

		await this.#ws.ready;
		this.#send(id, "signin", [vars]);

		const [res] = await this.nextEvent(id);

		if (res.error) throw new AuthenticationError(res.error.message);

		this.#token = res.result;
		return res.result;
	}

	/**
	 * Invalidates the authentication for the current connection.
	 */
	async invalidate(): Promise<void> {
		const id = guid();

		await this.#ws.ready;
		this.#send(id, "invalidate");

		const [res] = await this.nextEvent(id);

		if (res.error) throw new AuthenticationError(res.error.message);
		return res.result;
	}

	/**
	 * Authenticates the current connection with a JWT token.
	 * @param token - The JWT authentication token.
	 */
	async authenticate(token: string): Promise<void> {
		const id = guid();

		await this.#ws.ready;
		this.#send(id, "authenticate", [token]);

		const [res] = await this.nextEvent(id);

		if (res.error) throw new AuthenticationError(res.error.message);

		return res.result;
	}

	// --------------------------------------------------

	async live(table: string): Promise<string> {
		const id = guid();

		await this.#ws.ready;
		this.#send(id, "live", [table]);
		const [res] = await this.nextEvent(id);

		if (res.error) throw new Error(res.error.message);

		return res.result;
	}

	/**
	 * Kill a specific query.
	 * @param query - The query to kill.
	 */
	async kill(query: string): Promise<void> {
		const id = guid();

		await this.#ws.ready;
		this.#send(id, "kill", [query]);
		const [res] = await this.nextEvent(id);

		if (res.error) throw new Error(res.error.message);

		return res.result;
	}

	/**
	 * Switch to a specific namespace and database.
	 * @param key - Specifies the name of the variable.
	 * @param val - Assigns the value to the variable name.
	 */
	async let(key: string, val: unknown): Promise<string> {
		const id = guid();

		await this.#ws.ready;
		this.#send(id, "let", [key, val]);
		const [res] = await this.nextEvent(id);

		if (res.error) throw new Error(res.error.message);

		return res.result;
	}

	/**
	 * Runs a set of SurrealQL statements against the database.
	 * @param query - Specifies the SurrealQL statements.
	 * @param vars - Assigns variables which can be used in the query.
	 */
	async query<T = Result[]>(
		query: string,
		vars?: Record<string, unknown>,
	): Promise<T> {
		const id = guid();

		await this.#ws.ready;
		this.#send(id, "query", [query, vars]);
		const [res] = await this.nextEvent(id);

		if (res.error) throw new Error(res.error.message);

		return res.result;
	}

	/**
	 * Selects all records in a table, or a specific record, from the database.
	 * @param thing - The table name or a record ID to select.
	 */
	async select<T>(thing: string): Promise<T[]> {
		const id = guid();

		await this.#ws.ready;
		this.#send(id, "select", [thing]);
		const [res] = await this.nextEvent(id);
		return this.#outputHandlerB(
			res,
			thing,
			RecordError as typeof Error,
			`Record not found: ${id}`,
		);
	}

	/**
	 * Creates a record in the database.
	 * @param thing - The table name or the specific record ID to create.
	 * @param data - The document / record data to insert.
	 */
	async create<T extends Record<string, unknown>>(
		thing: string,
		data?: T,
	): Promise<T & { id: string }> {
		const id = guid();

		await this.#ws.ready;
		this.#send(id, "create", [thing, data]);
		const [res] = await this.nextEvent(id);
		this.#outputHandlerError(res);
		return this.#outputHandlerA(
			res,
			PermissionError as typeof Error,
			`Unable to create record: ${thing}`,
		);
	}

	/**
	 * Updates all records in a table, or a specific record, in the database.
	 *
	 * ***NOTE: This function replaces the current document / record data with the specified data.***
	 * @param thing - The table name or the specific record ID to update.
	 * @param data - The document / record data to insert.
	 */
	async update<T extends Record<string, unknown>>(
		thing: string,
		data?: T,
	): Promise<T & { id: string }> {
		const id = guid();

		await this.#ws.ready;
		this.#send(id, "update", [thing, data]);
		const [res] = await this.nextEvent(id);
		return this.#outputHandlerB(
			res,
			thing,
			PermissionError as typeof Error,
			`Unable to update record: ${thing}`,
		);
	}

	/**
	 * Modifies all records in a table, or a specific record, in the database.
	 *
	 * ***NOTE: This function merges the current document / record data with the specified data.***
	 * @param thing - The table name or the specific record ID to change.
	 * @param data - The document / record data to insert.
	 */
	async change<
		T extends Record<string, unknown>,
		U extends Record<string, unknown> = T,
	>(
		thing: string,
		data?: Partial<T> & U,
	): Promise<(T & U & { id: string }) | (T & U & { id: string })[]> {
		const id = guid();

		await this.#ws.ready;
		this.#send(id, "change", [thing, data]);
		const [res] = await this.nextEvent(id);
		return this.#outputHandlerB(
			res,
			thing,
			PermissionError as typeof Error,
			`Unable to update record: ${thing}`,
		);
	}

	/**
	 * Applies JSON Patch changes to all records, or a specific record, in the database.
	 *
	 * ***NOTE: This function patches the current document / record data with the specified JSON Patch data.***
	 * @param thing - The table name or the specific record ID to modify.
	 * @param data - The JSON Patch data with which to modify the records.
	 */
	async modify(thing: string, data?: Patch[]): Promise<Patch[]> {
		const id = guid();

		await this.#ws.ready;
		this.#send(id, "modify", [thing, data]);
		const [res] = await this.nextEvent(id);
		return this.#outputHandlerB(
			res,
			thing,
			PermissionError as typeof Error,
			`Unable to update record: ${thing}`,
		);
	}

	/**
	 * Deletes all records in a table, or a specific record, from the database.
	 * @param thing - The table name or a record ID to select.
	 */
	async delete(thing: string): Promise<void> {
		const id = guid();

		await this.#ws.ready;
		this.#send(id, "delete", [thing]);
		const [res] = await this.nextEvent(id);
		this.#outputHandlerError(res);
		return;
	}

	run<T>(runner: (surreal: Surreal) => T) {
		return runner(this);
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

	#outputHandlerA<T>(
		res: Result<T>,
		error: typeof Error,
		errormessage: string,
	) {
		if (Array.isArray(res.result) && res.result.length) {
			return res.result[0];
		}
		throw new error(errormessage);
	}

	#outputHandlerB<T>(
		res: Result<T>,
		id: string,
		error: typeof Error,
		errormessage: string,
	) {
		this.#outputHandlerError(res);
		if (typeof id === "string" && id.includes(":")) {
			this.#outputHandlerA(res, error, errormessage);
		} else {
			return res.result;
		}
	}

	#outputHandlerError<T>(res: Result<T>) {
		if (res.error) {
			throw new Error(res.error.message);
		}
	}
}
