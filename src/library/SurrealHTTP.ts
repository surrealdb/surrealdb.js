import { NoConnectionDetails } from "../errors.ts";
import { processUrl } from "./processUrl.ts";

export class SurrealHTTP<TFetcher = typeof fetch> {
	private url: string;
	private authorization?: string;
	private namespace?: string;
	private database?: string;
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

	use({ ns, db }: { ns?: string; db?: string }) {
		if (ns) this.namespace = ns;
		if (db) this.database = db;
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
