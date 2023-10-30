import { NoConnectionDetails } from "../errors.ts";
import { SurrealHTTP } from "../library/SurrealHTTP.ts";
import { processAuthVars } from "../library/processAuthVars.ts";
import {
	type ActionResult,
	AnyAuth,
	type Connection,
	ConnectionOptions,
	HTTPAuthenticationResponse,
	HTTPConstructorOptions,
	type InvalidSQL,
	type MapQueryResult,
	processConnectionOptions,
	type QueryResult,
	type RawQueryResult,
	ScopeAuth,
	Token,
	TransformAuth,
	UseOptions,
} from "../types.ts";

export class HTTPStrategy<TFetcher = typeof fetch> implements Connection {
	protected http?: SurrealHTTP<TFetcher>;
	public ready: Promise<void>;
	private resolveReady: () => void;
	private fetch: TFetcher;

	public strategy: "ws" | "http" = "http";

	/**
	 * Establish a socket connection to the database
	 * @param connection - Connection details
	 */
	constructor(opts: HTTPConstructorOptions<TFetcher> = {}) {
		HTTPConstructorOptions.parse(opts);
		this.fetch = opts.fetch ?? (fetch as TFetcher);
		this.resolveReady = () => {}; // Purely for typescript typing :)
		this.ready = new Promise((r) => (this.resolveReady = r));
	}

	/**
	 * Establish a socket connection to the database
	 * @param connection - Connection details
	 */
	async connect(
		url: string,
		opts: ConnectionOptions = {},
	) {
		const { prepare, auth, namespace, database } = processConnectionOptions(
			opts,
		);
		this.http = new SurrealHTTP<TFetcher>(url, { fetch: this.fetch });
		await this.use({ namespace, database });

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
	use(opt: Partial<UseOptions>) {
		if (!this.http) throw new NoConnectionDetails();

		const { namespace, database } = UseOptions.partial().strict().parse(
			opt,
		);
		if (namespace) this.http.namespace = namespace;
		if (database) this.http.database = database;
	}

	/**
	 * Signs up to a specific authentication scope.
	 * @param vars - Variables used in a signup query.
	 * @return The authentication token.
	 */
	async signup(vars: ScopeAuth) {
		vars = ScopeAuth.parse(vars);
		vars = processAuthVars(vars, {
			namespace: this.http?.namespace,
			database: this.http?.database,
		});

		const res = await this.request("/signup", {
			method: "POST",
			body: TransformAuth.parse(vars),
		}).then(HTTPAuthenticationResponse.parse);

		if (res.code === 403) throw new Error(res.description);
		this.http?.setTokenAuth(res.token);
		return res.token;
	}

	/**
	 * Signs in to a specific authentication scope.
	 * @param vars - Variables used in a signin query.
	 * @return The authentication token, unless signed in as root.
	 */
	async signin(vars: AnyAuth) {
		vars = AnyAuth.parse(vars);
		vars = processAuthVars(vars, {
			namespace: this.http?.namespace,
			database: this.http?.database,
		});

		const res = await this.request("/signin", {
			method: "POST",
			body: TransformAuth.parse(vars),
		}).then(HTTPAuthenticationResponse.parse);

		if (res.code === 403) throw new Error(res.description);
		this.http?.setTokenAuth(res.token);
		return res.token;
	}

	/**
	 * Authenticates the current connection with a JWT token.
	 * @param token - The JWT authentication token.
	 */
	authenticate(token: Token) {
		this.http?.setTokenAuth(Token.parse(token));
		return true;
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
	async query<T extends RawQueryResult[]>(
		query: string,
		vars?: Record<string, unknown>,
	) {
		await this.ready;
		const res = await this.request<InvalidSQL | MapQueryResult<T>>("/sql", {
			body: query,
			plainBody: true,
			method: "POST",
			searchParams: vars &&
				new URLSearchParams(
					Object.fromEntries(
						Object.entries(vars).map(([k, v]) => [
							k,
							JSON.stringify(v),
						]),
					),
				),
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
