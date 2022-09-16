import guid from "./utils/guid";
import errors from "./errors/index.js";
import Live from "./classes/live.js";
import Socket from "./classes/socket.js";
import Pinger from "./classes/pinger.js";
import Emitter from "./classes/emitter.js";

let singleton: Surreal = undefined;

/** Class representing a SurrealDB instance. */
export default class Surreal extends Emitter {

	/**
	 * The Instance static singleton ensures that a single database instance is available across very large or complicated applications. 
	 * With the singleton, only one connection to the database is instantiated, and the database connection does not have to be shared 
	 * across components or controllers.
	 * @return {Surreal} A Surreal object.
	 */
	static get Instance(): Surreal {
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

	#ws = undefined;

	#url = undefined;

	#token = undefined;

	#pinger = undefined;

	#attempted = undefined;

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

	/**
	 * Initializee a SurrealDb.
	 * @param {?string} url - The url of the database endpoint to connect to.
	 * @param {?string} token - The authorization token.
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
	 * @param {string} url - The url of the database endpoint to connect to.
	 * @return {Promise<void>}
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

		this.#ws.on("message", (e) => {

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

	// TODO: Need to add docs for this method
	sync(query: string, vars: any): Live {
		return new Live(this, query, vars);
	}

	/**
	 * Waits for the connection to the database to succeed.
	 * @return {Promise<void>}
	 */
	wait(): Promise<void> {
		return this.#ws.ready.then( () => {
			return this.#attempted;
		});
	}

	/**
	 * Closes the persistent connection to the database.
	 * @return {void}
	 */
	close(): void {
		this.#ws.removeAllListeners();
		this.#ws.close();
	}

	// --------------------------------------------------

	/**
	 * Ping SurrealDB instance
	 * @return {Promise<void>}
	 */
	ping(): Promise<void> {
		let id = guid();
		return this.#ws.ready.then( () => {
			return new Promise( () => {
				this.#send(id, "ping");
			});
		});
	}

	/**
	 * Switch to a specific namespace and database.
	 * @param {string} ns - Switches to a specific namespace.
	 * @param {string} db - Switches to a specific database.
	 * @return {Promise<void>}
	 */
	use(ns: string, db: string): Promise<void> {
		let id = guid();
		return this.#ws.ready.then( () => {
			return new Promise( (resolve, reject) => {
				this.once(id, res => this.#result(res, resolve, reject) );
				this.#send(id, "use", [ns, db]);
			});
		});
	}

	/**
	 * Retreive info about the current Surreal instance
	 * @return {Promise<any>} The info about the current Surreal instance
	 */
	info(): Promise<any> {
		let id = guid();
		return this.#ws.ready.then( () => {
			return new Promise( (resolve, reject) => {
				this.once(id, res => this.#result(res, resolve, reject) );
				this.#send(id, "info");
			});
		});
	}

	/**
	 * Signs up to a specific authentication scope.
	 * @param {any} vars - Variables used in a signup query.
	 * @return {Promise<string>} The authenication token.
	 */
	signup(vars: any): Promise<string> {
		let id = guid();
		return this.#ws.ready.then( () => {
			return new Promise( (resolve, reject) => {
				this.once(id, res => this.#signup(res, resolve, reject) );
				this.#send(id, "signup", [vars]);
			});
		});
	}

	/**
	 * Signs in to a specific authentication scope.
	 * @param {any} vars - Variables used in a signin query.
	 * @return {Promise<string>} The authenication token.
	 */
	signin(vars: any): Promise<string> {
		let id = guid();
		return this.#ws.ready.then( () => {
			return new Promise( (resolve, reject) => {
				this.once(id, res => this.#signin(res, resolve, reject) );
				this.#send(id, "signin", [vars]);
			});
		});
	}

	/**
	 * Invalidates the authentication for the current connection.
	 * @return {Promise<void>}
	 */
	invalidate(): Promise<void> {
		let id = guid();
		return this.#ws.ready.then( () => {
			return new Promise( (resolve, reject) => {
				this.once(id, res => this.#auth(res, resolve, reject) );
				this.#send(id, "invalidate");
			});
		});
	}

	/**
	 * Authenticates the current connection with a JWT token.
	 * @param {string} token - The JWT authentication token.
	 * @return {Promise<void>}
	 */
	authenticate(token: string): Promise<void> {
		let id = guid();
		return this.#ws.ready.then( () => {
			return new Promise( (resolve, reject) => {
				this.once(id, res => this.#auth(res, resolve, reject) );
				this.#send(id, "authenticate", [token]);
			});
		});
	}

	// --------------------------------------------------

	// TODO: Need to add docs for this method
	live(table: string): Promise<any> {
		let id = guid();
		return this.wait().then( () => {
			return new Promise( (resolve, reject) => {
				this.once(id, res => this.#result(res, resolve, reject) );
				this.#send(id, "live", [table]);
			});
		});
	}

	/**
	 * Kill a specific query.
	 * @param {string} query - The query to kill.
	 * @return {Promise<void>}
	 */
	kill(query: string): Promise<void> {
		let id = guid();
		return this.wait().then( () => {
			return new Promise( (resolve, reject) => {
				this.once(id, res => this.#result(res, resolve, reject) );
				this.#send(id, "kill", [query]);
			});
		});
	}

	/**
	 * Switch to a specific namespace and database.
	 * @param {string} key - Specifies the name of the variable.
	 * @param {any} val - Assigns the value to the variable name.
	 * @return {Promise<void>}
	 */
	let(key: string, val: any): Promise<void> {
		let id = guid();
		return this.wait().then( () => {
			return new Promise( (resolve, reject) => {
				this.once(id, res => this.#result(res, resolve, reject) );
				this.#send(id, "let", [key, val]);
			});
		});
	}

	/**
	 * Runs a set of SurrealQL statements against the database.
	 * @param {string} query - Specifies the SurrealQL statements.
	 * @param {?any} vars - Assigns variables which can be used in the query.
	 * @return {Promise<any>}
	 */
	query(query: string, vars: any): Promise<any> {
		let id = guid();
		return this.wait().then( () => {
			return new Promise( (resolve, reject) => {
				this.once(id, res => this.#result(res, resolve, reject) );
				this.#send(id, "query", [query, vars]);
			});
		});
	}

	/**
	 * Selects all records in a table, or a specific record, from the database.
	 * @param {string} thing - The table name or a record ID to select.
	 * @return {Promise<any>}
	 */
	select(thing: string): Promise<any> {
		let id = guid();
		return this.wait().then( () => {
			return new Promise( (resolve, reject) => {
				this.once(id, res => this.#output(res, "select", thing, resolve, reject) );
				this.#send(id, "select", [thing]);
			});
		});
	}

	/**
	 * Creates a record in the database.
	 * @param {string} thing - The table name or the specific record ID to create.
	 * @param {?any} data - The document / record data to insert.
	 * @return {Promise<any>}
	 */
	create(thing: string, data: any): Promise<any> {
		let id = guid();
		return this.wait().then( () => {
			return new Promise( (resolve, reject) => {
				this.once(id, res => this.#output(res, "create", thing, resolve, reject) );
				this.#send(id, "create", [thing, data]);
			});
		});
	}

	/**
	 * Updates all records in a table, or a specific record, in the database.
	 * NOTE: This function replaces the current document / record data with the specified data.
	 * @param {string} thing - The table name or the specific record ID to update.
	 * @param {?any} data - The document / record data to insert.
	 * @return {Promise<any>}
	 */
	update(thing: string, data: any): Promise<any> {
		let id = guid();
		return this.wait().then( () => {
			return new Promise( (resolve, reject) => {
				this.once(id, res => this.#output(res, "update", thing, resolve, reject) );
				this.#send(id, "update", [thing, data]);
			});
		});
	}

	/**
	 * Modifies all records in a table, or a specific record, in the database.
	 * NOTE: This function merges the current document / record data with the specified data.
	 * @param {string} thing - The table name or the specific record ID to change.
	 * @param {?any} data - The document / record data to insert.
	 * @return {Promise<any>}
	 */
	change(thing: string, data: any): Promise<any> {
		let id = guid();
		return this.wait().then( () => {
			return new Promise( (resolve, reject) => {
				this.once(id, res => this.#output(res, "change", thing, resolve, reject) );
				this.#send(id, "change", [thing, data]);
			});
		});
	}

	/**
	 * Applies JSON Patch changes to all records, or a specific record, in the database.
	 * NOTE: This function patches the current document / record data with the specified JSON Patch data.
	 * @param {string} thing - The table name or the specific record ID to modify.
	 * @param {?any} data - The JSON Patch data with which to modify the records.
	 * @return {Promise<any>}
	 */
	modify(thing: string, data: any): Promise<any> {
		let id = guid();
		return this.wait().then( () => {
			return new Promise( (resolve, reject) => {
				this.once(id, res => this.#output(res, "modify", thing, resolve, reject) );
				this.#send(id, "modify", [thing, data]);
			});
		});
	}

	/**
	 * Deletes all records in a table, or a specific record, from the database.
	 * @param {string} thing - The table name or a record ID to select.
	 * @return {Promise<void>}
	 */
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
		this.#attempted = new Promise<void>( (res, rej) => {
			this.#token ? this.authenticate(this.#token).then(res).catch(res) : res();
		});
	}

	#send(id: string, method: string, params: any[] = []): void {
		this.#ws.send(JSON.stringify({
			id: id,
			method: method,
			params: params,
		}));
	}

	#auth(res: any, resolve: (value: any) => void, reject: (reason: any) => void) {
		if (res.error) {
			return reject( new Surreal.AuthenticationError(res.error.message) );
		} else {
			return resolve(res.result);
		}
	}

	#signin(res: any, resolve: (value: any) => void, reject: (reason: any) => void) {
		if (res.error) {
			return reject( new Surreal.AuthenticationError(res.error.message) );
		} else {
			this.#token = res.result;
			return resolve(res.result);
		}
	}

	#signup(res: any, resolve: (value: any) => void, reject: (reason: any) => void) {
		if (res.error) {
			return reject( new Surreal.AuthenticationError(res.error.message) );
		} else if (res.result) {
			this.#token = res.result;
			return resolve(res.result);
		}
	}

	#result(res: any, resolve: (value?: any) => void, reject: (reason: any) => void) {
		if (res.error) {
			return reject( new Error(res.error.message) );
		} else if (res.result) {
			return resolve(res.result);
		}
		return resolve();
	}

	#output(res: any, type: string, id: string, resolve: (value?: any) => void, reject: (reason: any) => void) {
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
