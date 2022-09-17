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
  op: 'add';
  value: any;
}

export interface RemovePatch extends BasePatch {
	op: 'remove';
}

export interface ReplacePatch extends BasePatch {
	op: 'replace';
  value: any;
}

export interface MovePatch extends BasePatch {
	op: 'move';
  from: string;
}

export interface CopyPatch extends BasePatch {
	op: 'copy';
  from: string;
}

export interface TestPatch extends BasePatch {
	op: 'test';
  value: any;
}

export type Patch = AddPatch | RemovePatch | ReplacePatch | MovePatch | CopyPatch | TestPatch;

interface ResultOk<T> {
	result: T
	error?: never
}

interface ResultErr {
	result?: never
	error: Error
}

export type Result<T = unknown> = ResultOk<T> | ResultErr

export interface AuthOpts {
	NS?: string
	DB?: string
}

export interface NamespaceAuth extends AuthOpts {
	user: string
	pass: string
}

export interface ScopeAuth extends AuthOpts {
	SC: string
	[key: string]: unknown
}

export type Auth = NamespaceAuth | ScopeAuth

export default class Surreal extends Emitter {

	// ------------------------------
	// Main singleton
	// ------------------------------

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

	constructor(url?: string, token?: string) {

		super();

		this.#url = url;

		this.#token = token;

		if (url) {
			this.connect(url);
		}

	}

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

			this.#pinger.start( () => {
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

		this.#ws.on("message", (e: { data: string }) => {

			let d = JSON.parse(e.data);

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

	wait(): Promise<void> {
		return this.#ws.ready.then( () => {
			return this.#attempted!;
		});
	}

	close(): void {
		this.#ws.close();
	}

	// --------------------------------------------------

	ping(): Promise<void> {
		let id = guid();
		return this.#ws.ready.then( () => {
			return new Promise( () => {
				this.#send(id, "ping");
			});
		});
	}

	use(ns: string, db: string): Promise<void> {
		let id = guid();
		return this.#ws.ready.then( () => {
			return new Promise( (resolve, reject) => {
				this.once(id, res => this.#result(res, resolve, reject) );
				this.#send(id, "use", [ns, db]);
			});
		});
	}

	info(): Promise<void> {
		let id = guid();
		return this.#ws.ready.then( () => {
			return new Promise( (resolve, reject) => {
				this.once(id, res => this.#result(res, resolve, reject) );
				this.#send(id, "info");
			});
		});
	}

	signup(vars: Auth): Promise<string> {
		let id = guid();
		return this.#ws.ready.then( () => {
			return new Promise( (resolve, reject) => {
				this.once(id, res => this.#signup(res, resolve, reject) );
				this.#send(id, "signup", [vars]);
			});
		});
	}

	signin(vars: Auth): Promise<string> {
		let id = guid();
		return this.#ws.ready.then( () => {
			return new Promise( (resolve, reject) => {
				this.once(id, res => this.#signin(res, resolve, reject) );
				this.#send(id, "signin", [vars]);
			});
		});
	}

	// @fixme: actually resolves null
	invalidate(): Promise<void> {
		let id = guid();
		return this.#ws.ready.then( () => {
			return new Promise( (resolve, reject) => {
				this.once(id, res => this.#auth(res, resolve, reject) );
				this.#send(id, "invalidate");
			});
		});
	}

	authenticate(token: string): Promise<void> {
		let id = guid();
		return this.#ws.ready.then( () => {
			return new Promise<unknown>( (resolve, reject) => {
				this.once(id, res => this.#auth(res, resolve, reject) );
				this.#send(id, "authenticate", [token]);
			}) as Promise<void>;
		});
	}

	// --------------------------------------------------

	live(table: string): Promise<string> {
		let id = guid();
		return this.wait().then( () => {
			return new Promise( (resolve, reject) => {
				this.once(id, res => this.#result(res, resolve, reject) );
				this.#send(id, "live", [table]);
			});
		});
	}

	kill(query: string): Promise<void> {
		let id = guid();
		return this.wait().then( () => {
			return new Promise( (resolve, reject) => {
				this.once(id, res => this.#result(res, resolve, reject) );
				this.#send(id, "kill", [query]);
			});
		});
	}

	let(key: string, val: unknown): Promise<string> {
		let id = guid();
		return this.wait().then( () => {
			return new Promise( (resolve, reject) => {
				this.once(id, res => this.#result(res, resolve, reject) );
				this.#send(id, "let", [key, val]);
			});
		});
	}

	query<T = Result[]>(query: string, vars?: Record<string, unknown>): Promise<T> {
		let id = guid();
		return this.wait().then( () => {
			return new Promise<T>( (resolve, reject) => {
				this.once(id, res => this.#result(res, resolve as () => void, reject) );
				this.#send(id, "query", [query, vars]);
			});
		});
	}

	select<T>(thing: string): Promise<T[]> {
		let id = guid();
		return this.wait().then( () => {
			return new Promise( (resolve, reject) => {
				this.once(id, res => this.#output(res, "select", thing, resolve, reject) );
				this.#send(id, "select", [thing]);
			})
		});
	}

	create<T extends object>(thing: string, data?: T): Promise<T & { id: string }> {
		let id = guid();
		return this.wait().then( () => {
			return new Promise( (resolve, reject) => {
				this.once(id, res => this.#output(res, "create", thing, resolve, reject) );
				this.#send(id, "create", [thing, data]);
			});
		});
	}

	update<T extends object>(thing: string, data?: T): Promise<T & { id: string }> {
		let id = guid();
		return this.wait().then( () => {
			return new Promise( (resolve, reject) => {
				this.once(id, res => this.#output(res, "update", thing, resolve, reject) );
				this.#send(id, "update", [thing, data]);
			});
		});
	}

	change<T extends object, U extends object = T>(thing: string, data?: Partial<T> & U): Promise<T & U & { id: string }> {
		let id = guid();
		return this.wait().then( () => {
			return new Promise( (resolve, reject) => {
				this.once(id, res => this.#output(res, "change", thing, resolve, reject) );
				this.#send(id, "change", [thing, data]);
			});
		});
	}

	modify(thing: string, data?: Patch[]) {
		let id = guid();
		return this.wait().then( () => {
			return new Promise( (resolve, reject) => {
				this.once(id, res => this.#output(res, "modify", thing, resolve, reject) );
				this.#send(id, "modify", [thing, data]);
			});
		});
	}

	delete(thing: string): Promise<void> {
		let id = guid();
		return this.wait().then( () => {
			return new Promise( (resolve, reject) => {
				this.once(id, res => this.#output(res, "delete", thing, resolve, reject) );
				this.#send(id, "delete", [thing]);
			});
		});
	}

	// --------------------------------------------------
	// Private methods
	// --------------------------------------------------

	#init(): void {
		this.#attempted = new Promise( (res, rej) => {
			this.#token ? this.authenticate(this.#token).then(res).catch(res) : res();
		});
	}

	#send(id: string, method: string, params: unknown[] = []): void {
		this.#ws.send(JSON.stringify({
			id: id,
			method: method,
			params: params,
		}));
	}

	#auth<T>(res: Result<T>, resolve: (value: T) => void, reject: (reason?: any) => void): void {
		if (res.error) {
			return reject( new Surreal.AuthenticationError(res.error.message) );
		} else {
			return resolve(res.result);
		}
	}

	#signin(res: Result<string>, resolve: (value: string) => void, reject: (reason?: any) => void): void {
		if (res.error) {
			return reject( new Surreal.AuthenticationError(res.error.message) );
		} else {
			this.#token = res.result;
			return resolve(res.result);
		}
	}

	#signup(res: Result<string>, resolve: (value: string) => void, reject: (reason?: any) => void): void {
		if (res.error) {
			return reject( new Surreal.AuthenticationError(res.error.message) );
		} else if (res.result) {
			this.#token = res.result;
			return resolve(res.result);
		}
	}

	#result<T>(res: Result<T>, resolve: (value: T) => void, reject: (reason?: any) => void): void {
		if (res.error) {
			return reject( new Error(res.error.message) );
		} else if (res.result) {
			return resolve(res.result);
		}
		return resolve(undefined as T);
	}

	#output<T>(res: Result<T>, type: string, id: string, resolve: (value: T) => void, reject: (reason?: any) => void): void {
		if (res.error) {
			return reject( new Error(res.error.message) );
		} else if (res.result) {
			switch (type) {
			case "delete":
				return resolve(undefined as T);
			case "create":
				return Array.isArray(res.result) && res.result.length ? resolve(res.result[0]) : reject(
					new Surreal.PermissionError(`Unable to create record: ${id}`)
				);
			case "update":
				if ( typeof id === "string" && id.includes(":") ) {
					return Array.isArray(res.result) && res.result.length ? resolve(res.result[0]) : reject(
						new Surreal.PermissionError(`Unable to update record: ${id}`)
					);
				} else {
					return resolve(res.result);
				}
			case "change":
				if ( typeof id === "string" && id.includes(":") ) {
					return Array.isArray(res.result) && res.result.length ? resolve(res.result[0]) : reject(
						new Surreal.PermissionError(`Unable to update record: ${id}`)
					);
				} else {
					return resolve(res.result);
				}
			case "modify":
				if ( typeof id === "string" && id.includes(":") ) {
					return Array.isArray(res.result) && res.result.length ? resolve(res.result[0]) : reject(
						new Surreal.PermissionError(`Unable to update record: ${id}`)
					);
				} else {
					return resolve(res.result);
				}
			default:
				if ( typeof id === "string" && id.includes(":") ) {
					return Array.isArray(res.result) && res.result.length ? resolve(res.result) : reject(
						new Surreal.RecordError(`Record not found: ${id}`)
					);
				} else {
					return resolve(res.result);
				}
			}
		}
		return resolve(undefined as T);
	}

}
