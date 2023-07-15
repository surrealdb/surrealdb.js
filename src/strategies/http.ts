import { NoConnectionDetails } from "../errors.ts";
import { SurrealHTTP } from "../library/SurrealHTTP.ts";
import {
	type ActionResult,
	type AnyAuth,
	type Connection,
	type HTTPAuthenticationResponse,
	type HTTPConnectionOptions,
	type InvalidSQL,
	type MapQueryResult,
	type QueryResult,
	type RawQueryResult,
	type ScopeAuth,
	type Token,
} from "../types.ts";

export class HTTPStrategy<TFetcher = typeof fetch> implements Connection {
	protected http?: SurrealHTTP<TFetcher>;
	public ready: Promise<void>;
	private resolveReady: () => void;

	public strategy: "ws" | "http" = "http";

	/**
	 * Establish a socket connection to the database
	 * @param connection - Connection details
	 */
	constructor(url?: string, options: HTTPConnectionOptions<TFetcher> = {}) {
		this.resolveReady = () => {}; // Purely for typescript typing :)
		this.ready = new Promise((r) => (this.resolveReady = r));
		if (url) this.connect(url, options);
	}

	/**
	 * Establish a socket connection to the database
	 * @param connection - Connection details
	 */
	async connect(
		url: string,
		{
			fetch: fetcher,
			prepare,
			auth,
			ns,
			db,
		}: HTTPConnectionOptions<TFetcher> = {},
	) {
		this.http = new SurrealHTTP<TFetcher>(url, { fetcher });
		await this.use({ ns, db });
		if (typeof auth === "string") {
			await this.authenticate(auth);
		} else if (auth) {
			await this.signin(auth);
		}

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
	use({ ns, db }: { ns?: string; db?: string }) {
		if (!this.http) throw new NoConnectionDetails();
		return this.http.use({ ns, db });
	}

	/**
	 * Signs up to a specific authentication scope.
	 * @param vars - Variables used in a signup query.
	 * @return The authentication token.
	 */
	async signup({
		NS = this.http?.namespace,
		DB = this.http?.database,
		...rest
	}: Partial<ScopeAuth> & Pick<ScopeAuth, "SC">) {
		const res = await this.request<HTTPAuthenticationResponse>("/signup", {
			method: "POST",
			body: { NS, DB, ...rest },
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
		if (arguments[1]) {
			throw new Error(
				"The query function in the HTTP strategy does not support data as the second argument.",
			);
		}

		await this.ready;
		const res = await this.request<InvalidSQL | MapQueryResult<T>>("/sql", {
			body: query,
			plainBody: true,
			method: "POST",
		});

		if ("information" in res) throw new Error(res.information);
		return res;
	}

	/**
	 * Selects all records in a table, or a specific record, from the database.
	 * @param thing - The table name or a record ID to select.
	 */
	async select<T extends Record<string, unknown>>(thing: string) {
		await this.ready;
		const url = `/key/${this.modifyThing(thing)}`;
		const [res] = await this.request<[QueryResult<ActionResult<T>[]>]>(
			url,
			{
				method: "GET",
			},
		);

		if (res.status == "ERR") throw new Error(res.detail);
		return res.result;
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
		const url = `/key/${this.modifyThing(thing)}`;
		const [res] = await this.request<[QueryResult<ActionResult<T, U>[]>]>(
			url,
			{
				method: "POST",
				body: data,
			},
		);

		if (res.status == "ERR") throw new Error(res.detail);
		return res.result;
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
		const url = `/key/${this.modifyThing(thing)}`;
		const [res] = await this.request<[QueryResult<ActionResult<T, U>[]>]>(
			url,
			{
				method: "PUT",
				body: data,
			},
		);

		if (res.status == "ERR") throw new Error(res.detail);
		return res.result;
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
		const url = `/key/${this.modifyThing(thing)}`;
		const [res] = await this.request<[QueryResult<ActionResult<T, U>[]>]>(
			url,
			{
				method: "PATCH",
				body: data,
			},
		);

		if (res.status == "ERR") throw new Error(res.detail);
		return res.result;
	}

	/**
	 * Deletes all records in a table, or a specific record, from the database.
	 * @param thing - The table name or a record ID to select.
	 */
	async delete<T extends Record<string, unknown> = Record<string, unknown>>(
		thing: string,
	) {
		await this.ready;
		const url = `/key/${this.modifyThing(thing)}`;
		const [res] = await this.request<[QueryResult<ActionResult<T>[]>]>(
			url,
			{
				method: "DELETE",
			},
		);

		if (res.status == "ERR") throw new Error(res.detail);
		return res.result;
	}

	protected get request() {
		if (!this.http) throw new NoConnectionDetails();
		return this.http.request.bind(this.http);
	}

	/**
	 * Reset the ready mechanism.
	 */
	private resetReady() {
		this.ready = new Promise((r) => (this.resolveReady = r));
	}

	private modifyThing(thing: string) {
		const regex = /([^`:⟨⟩]+|\`.+\`|⟨.+⟩):([^`:⟨⟩]+|\`.+\`|⟨.+⟩)/;
		thing = thing.replace(regex, "$1/$2");
		return thing;
	}
}
