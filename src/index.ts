import guid from "./utils/guid.js";
import errors from "./errors/index.js";
import Live from "./classes/live.js";
import Socket from "./classes/socket.js";
import Pinger from "./classes/pinger.js";
import Emitter from "./classes/emitter.js";

let singleton: Surreal;

export interface Result {
	result?: string[]
	error?: Error
	status: string
	time: string
}

export default class Surreal extends Emitter {

	// ------------------------------
	// Main singleton
	// ------------------------------

	static get Instance() {
		return singleton ? singleton : singleton = new Surreal();
	}

	// ------------------------------
	// Public types
	// ------------------------------

	static get AuthenticationError() {
		return errors.AuthenticationError;
	}

	static get PermissionError() {
		return errors.PermissionError;
	}

	static get RecordError() {
		return errors.RecordError;
	}

	static get Live() {
		return Live;
	}

	// ------------------------------
	// Properties
	// ------------------------------

	#ws: Socket;

	#url?: string;

	#token?: string;

	#pinger: Pinger;

	#attempted?: Promise<void>;

	// ------------------------------
	// Accessors
	// ------------------------------

	get token() {
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

	connect(url: string) {

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
				return d.params.forEach(r => {
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

	sync(query, vars: Record<string, unknown>) {
		return new Live(this, query, vars);
	}

	wait() {
		return this.#ws.ready.then( () => {
			return this.#attempted!;
		});
	}

	close() {
		this.#ws.removeAllListeners();
		this.#ws.close();
	}

	// --------------------------------------------------

	ping() {
		let id = guid();
		return this.#ws.ready.then( () => {
			return new Promise( () => {
				this.#send(id, "ping");
			});
		});
	}

	use(ns: string, db: string) {
		let id = guid();
		return this.#ws.ready.then( () => {
			return new Promise( (resolve, reject) => {
				this.once(id, res => this.#result(res, resolve, reject) );
				this.#send(id, "use", [ns, db]);
			});
		});
	}

	info() {
		let id = guid();
		return this.#ws.ready.then( () => {
			return new Promise( (resolve, reject) => {
				this.once(id, res => this.#result(res, resolve, reject) );
				this.#send(id, "info");
			});
		});
	}

	signup(vars) {
		let id = guid();
		return this.#ws.ready.then( () => {
			return new Promise( (resolve, reject) => {
				this.once(id, res => this.#signup(res, resolve, reject) );
				this.#send(id, "signup", [vars]);
			});
		});
	}

	signin(vars) {
		let id = guid();
		return this.#ws.ready.then( () => {
			return new Promise( (resolve, reject) => {
				this.once(id, res => this.#signin(res, resolve, reject) );
				this.#send(id, "signin", [vars]);
			});
		});
	}

	invalidate() {
		let id = guid();
		return this.#ws.ready.then( () => {
			return new Promise( (resolve, reject) => {
				this.once(id, res => this.#auth(res, resolve, reject) );
				this.#send(id, "invalidate");
			});
		});
	}

	authenticate(token: string) {
		let id = guid();
		return this.#ws.ready.then( () => {
			return new Promise<void>( (resolve, reject) => {
				this.once(id, res => this.#auth(res, resolve, reject) );
				this.#send(id, "authenticate", [token]);
			});
		});
	}

	// --------------------------------------------------

	live(table: string) {
		let id = guid();
		return this.wait().then( () => {
			return new Promise( (resolve, reject) => {
				this.once(id, res => this.#result(res, resolve, reject) );
				this.#send(id, "live", [table]);
			});
		});
	}

	kill(query: string) {
		let id = guid();
		return this.wait().then( () => {
			return new Promise( (resolve, reject) => {
				this.once(id, res => this.#result(res, resolve, reject) );
				this.#send(id, "kill", [query]);
			});
		});
	}

	let(key: string, val: unknown) {
		let id = guid();
		return this.wait().then( () => {
			return new Promise( (resolve, reject) => {
				this.once(id, res => this.#result(res, resolve, reject) );
				this.#send(id, "let", [key, val]);
			});
		});
	}

	query(query: string, vars?: Record<string, unknown>) {
		let id = guid();
		return this.wait().then( () => {
			return new Promise( (resolve, reject) => {
				this.once(id, res => this.#result(res, resolve, reject) );
				this.#send(id, "query", [query, vars]);
			});
		});
	}

	select(thing: string) {
		let id = guid();
		return this.wait().then( () => {
			return new Promise<unknown[]>( (resolve, reject) => {
				this.once(id, res => this.#output(res, "select", thing, resolve, reject) );
				this.#send(id, "select", [thing]);
			});
		});
	}

	create(thing: string, data?: unknown) {
		let id = guid();
		return this.wait().then( () => {
			return new Promise( (resolve, reject) => {
				this.once(id, res => this.#output(res, "create", thing, resolve, reject) );
				this.#send(id, "create", [thing, data]);
			});
		});
	}

	update(thing: string, data?: unknown) {
		let id = guid();
		return this.wait().then( () => {
			return new Promise( (resolve, reject) => {
				this.once(id, res => this.#output(res, "update", thing, resolve, reject) );
				this.#send(id, "update", [thing, data]);
			});
		});
	}

	change(thing: string, data?: unknown) {
		let id = guid();
		return this.wait().then( () => {
			return new Promise( (resolve, reject) => {
				this.once(id, res => this.#output(res, "change", thing, resolve, reject) );
				this.#send(id, "change", [thing, data]);
			});
		});
	}

	modify(thing: string, data?: unknown[]) {
		let id = guid();
		return this.wait().then( () => {
			return new Promise( (resolve, reject) => {
				this.once(id, res => this.#output(res, "modify", thing, resolve, reject) );
				this.#send(id, "modify", [thing, data]);
			});
		});
	}

	delete(thing: string) {
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

	#init() {
		this.#attempted = new Promise( (res, rej) => {
			this.#token ? this.authenticate(this.#token).then(res).catch(res) : res();
		});
	}

	#send(id: string, method: string, params: unknown[] = []) {
		this.#ws.send(JSON.stringify({
			id: id,
			method: method,
			params: params,
		}));
	}

	#auth(res, resolve, reject) {
		if (res.error) {
			return reject( new Surreal.AuthenticationError(res.error.message) );
		} else {
			return resolve(res.result);
		}
	}

	#signin(res, resolve, reject) {
		if (res.error) {
			return reject( new Surreal.AuthenticationError(res.error.message) );
		} else {
			this.#token = res.result;
			return resolve(res.result);
		}
	}

	#signup(res, resolve, reject) {
		if (res.error) {
			return reject( new Surreal.AuthenticationError(res.error.message) );
		} else if (res.result) {
			this.#token = res.result;
			return resolve(res.result);
		}
	}

	#result(res: Result, resolve: (value?: string[]) => void, reject: (reason?: any) => void) {
		if (res.error) {
			return reject( new Error(res.error.message) );
		} else if (res.result) {
			return resolve(res.result);
		}
		return resolve();
	}

	#output(res: Result, type: string, id: string, resolve: (value?: unknown) => void, reject: (reason?: any) => void) {
		if (res.error) {
			return reject( new Error(res.error.message) );
		} else if (res.result) {
			switch (type) {
			case "delete":
				return resolve();
			case "create":
				return res.result && res.result.length ? resolve(res.result[0]) : reject(
					new Surreal.PermissionError(`Unable to create record: ${id}`)
				);
			case "update":
				if ( typeof id === "string" && id.includes(":") ) {
					return res.result && res.result.length ? resolve(res.result[0]) : reject(
						new Surreal.PermissionError(`Unable to update record: ${id}`)
					);
				} else {
					return resolve(res.result);
				}
			case "change":
				if ( typeof id === "string" && id.includes(":") ) {
					return res.result && res.result.length ? resolve(res.result[0]) : reject(
						new Surreal.PermissionError(`Unable to update record: ${id}`)
					);
				} else {
					return resolve(res.result);
				}
			case "modify":
				if ( typeof id === "string" && id.includes(":") ) {
					return res.result && res.result.length ? resolve(res.result[0]) : reject(
						new Surreal.PermissionError(`Unable to update record: ${id}`)
					);
				} else {
					return resolve(res.result);
				}
			default:
				if ( typeof id === "string" && id.includes(":") ) {
					return res.result && res.result.length ? resolve(res.result) : reject(
						new Surreal.RecordError(`Record not found: ${id}`)
					);
				} else {
					return resolve(res.result);
				}
			}
		}
		return resolve();
	}

}
