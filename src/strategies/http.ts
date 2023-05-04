import { NoConnectionDetails } from "../errors.ts";
import { SurrealHTTP } from "../library/SurrealHTTP.ts";
import {
	type AnyAuth,
	type Connection,
	type HTTPAuthenticationResponse,
	type HTTPConnectionOptions,
	type InvalidSQL,
	type MapQueryResult,
	type RawQueryResult,
	type ScopeAuth,
	type Token,
} from "../types.ts";

export class HTTPStrategy<TFetcher = typeof fetch> implements Connection {
	protected http?: SurrealHTTP<TFetcher>;
	public ready: Promise<void>;
	private resolveReady: () => void;

	/**
	 * Establish a socket connection to the database
	 * @param connection - Connection details
	 */
	constructor(url: string, options: HTTPConnectionOptions<TFetcher>) {
		this.resolveReady = () => {}; // Purely for typescript typing :)
		this.ready = new Promise((r) => (this.resolveReady = r));
		this.connect(url, options);
	}

	/**
	 * Establish a socket connection to the database
	 * @param connection - Connection details
	 */
	async connect(
		urlRaw: string,
		{ fetch: fetcher, prepare }: HTTPConnectionOptions<TFetcher> = {},
	) {
		const url = new URL(urlRaw);
		this.http = new SurrealHTTP<TFetcher>(url, { fetcher });
		await prepare?.(this);
		this.resolveReady();
		await this.ready;
	}

	/**
	 * Disconnect the socket to the database
	 */
	close() {
		this.http = undefined;
		this.resetReady();
	}

	/**
	 * Check if connection is ready
	 */
	wait() {
		if (!this.http) throw new NoConnectionDetails();
		return this.ready;
	}

	/**
	 * Get status of the socket connection
	 */
	get status() {
		return this.request("/status");
	}

	/**
	 * Ping SurrealDB instance
	 */
	async ping() {
		await this.request("/health");
	}

	/**
	 * Switch to a specific namespace and database.
	 * @param ns - Switches to a specific namespace.
	 * @param db - Switches to a specific database.
	 */
	use(ns: string, db: string) {
		if (!this.http) throw new NoConnectionDetails();
		return this.http.use(ns, db);
	}

	/**
	 * Signs up to a specific authentication scope.
	 * @param vars - Variables used in a signup query.
	 * @return The authentication token.
	 */
	async signup(vars: ScopeAuth) {
		const res = await this.request<HTTPAuthenticationResponse>("/signup", {
			method: "POST",
			body: vars,
		});

		if (res.description) throw new Error(res.description);
		if (!res.token) throw new Error("Did not receive authentication token");
		this.http?.setTokenAuth(res.token);
		return res.token;
	}

	/**
	 * Signs in to a specific authentication scope.
	 * @param vars - Variables used in a signin query.
	 * @return The authentication token, unless signed in as root.
	 */
	async signin(vars: AnyAuth) {
		const res = await this.request<HTTPAuthenticationResponse>("/signin", {
			method: "POST",
			body: vars,
		});

		if (res.description) throw new Error(res.description);
		if (!res.token) {
			this.http?.createRootAuth(vars.user as string, vars.pass as string);
		} else {
			this.http?.setTokenAuth(res.token);
			return res.token;
		}
	}

	/**
	 * Authenticates the current connection with a JWT token.
	 * @param token - The JWT authentication token.
	 */
	authenticate(token: Token) {
		this.http?.setTokenAuth(token);
	}

	/**
	 * Invalidates the authentication for the current connection.
	 */
	invalidate() {
		this.http?.clearAuth();
	}

	/**
	 * Runs a set of SurrealQL statements against the database.
	 * @param query - Specifies the SurrealQL statements.
	 * @param vars - Assigns variables which can be used in the query.
	 */
	async query<T extends RawQueryResult[]>(query: string) {
		await this.ready;
		const res = await this.request<InvalidSQL | MapQueryResult<T>>("/sql", {
			body: query,
			plainBody: true,
			method: "POST",
		});

		if ("information" in res) throw new Error(res.information);
		return res;
	}

	protected get request() {
		if (!this.http) throw new NoConnectionDetails();
		return this.http.request;
	}

	/**
	 * Reset the ready mechanism.
	 */
	private resetReady() {
		this.ready = new Promise((r) => (this.resolveReady = r));
	}
}
