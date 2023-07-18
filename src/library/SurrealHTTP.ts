import { NoConnectionDetails } from "../errors.ts";
import { processUrl } from "./processUrl.ts";

export class SurrealHTTP<TFetcher = typeof fetch> {
	private url: string;
	private authorization?: string;
	private _namespace?: string;
	private _database?: string;
	private fetch: TFetcher;

	constructor(url: string, {
		fetcher,
	}: {
		fetcher?: TFetcher;
	} = {}) {
		this.fetch = fetcher ?? fetch as TFetcher;
		this.url = processUrl(url, {
			ws: "http",
			wss: "https",
		});
	}

	ready() {
		return !!(this.url && this._namespace && this._database);
	}

	setTokenAuth(token: string) {
		this.authorization = `Bearer ${token}`;
	}

	createRootAuth(username: string, password: string) {
		this.authorization = `Basic ${btoa(`${username}:${password}`)}`;
	}

	clearAuth() {
		this.authorization = undefined;
	}

	use({ ns, db }: { ns?: string; db?: string }) {
		if (ns) this._namespace = ns;
		if (db) this._database = db;
	}

	get namespace() {
		return this._namespace;
	}

	get database() {
		return this._database;
	}

	async request<T = unknown>(path: string, options?: {
		method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
		plainBody?: boolean;
		body?: Record<string, unknown> | string;
	}): Promise<T> {
		path = path.startsWith("/") ? path.slice(1) : path;
		if (!this.ready()) throw new NoConnectionDetails();
		return (await (this.fetch as typeof fetch)(
			`${this.url}/${path}`,
			{
				method: options?.method ?? "POST",
				headers: {
					"Content-Type": options?.plainBody
						? "text/plain"
						: "application/json",
					"Accept": "application/json",
					"NS": this._namespace!,
					"DB": this._database!,
					...(this.authorization
						? { "Authorization": this.authorization }
						: {}),
				},
				body: typeof options?.body == "string"
					? options?.body
					: JSON.stringify(options?.body),
			},
		)).json() as T;
	}
}
