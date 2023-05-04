import { NoConnectionDetails } from "../errors.ts";

export class SurrealHTTP<TFetcher = typeof fetch> {
	private url: URL;
	private authorization?: string;
	private namespace?: string;
	private database?: string;
	private fetch: TFetcher;

	constructor(url: URL, {
		fetcher,
	}: {
		fetcher?: TFetcher;
	} = {}) {
		this.fetch = fetcher ?? fetch as TFetcher;
		this.url = url;
	}

	ready() {
		return !!(this.url && this.namespace && this.database);
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

	use(ns: string, db: string) {
		this.namespace = ns;
		this.database = db;
	}

	async request<T = unknown>(path: string, options?: {
		method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
		plainBody?: boolean;
		body?: Record<string, unknown> | string;
	}): Promise<T> {
		path = path.startsWith("/") ? path.slice(1) : path;
		if (!this.ready()) throw new NoConnectionDetails();
		return (await (this.fetch as typeof fetch)(
			`${this.url!.origin}/${path}`,
			{
				method: options?.method ?? "POST",
				headers: {
					"Content-Type": options?.plainBody
						? "text/plain"
						: "application/json",
					"Accept": "application/json",
					"NS": this.namespace!,
					"DB": this.database!,
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
