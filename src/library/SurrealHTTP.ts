import { NoConnectionDetails } from "../errors.ts";
import { HTTPConstructorOptions } from "../types.ts";
import { processUrl } from "./processUrl.ts";

export class SurrealHTTP<TFetcher = typeof fetch> {
	private url: string;
	private authorization?: string;
	private fetch: TFetcher;
	public namespace?: string;
	public database?: string;

	constructor(
		url: string,
		{ fetch: f }: HTTPConstructorOptions<TFetcher> = {},
	) {
		this.fetch = f ?? (fetch as TFetcher);
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

	clearAuth() {
		this.authorization = undefined;
	}

	async request<T = unknown>(
		path: string,
		options?: {
			method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
			plainBody?: boolean;
			body?: Record<string, unknown> | string;
			searchParams?: URLSearchParams;
		},
	): Promise<T> {
		path = path.startsWith("/") ? path.slice(1) : path;
		if (!this.ready()) throw new NoConnectionDetails();
		return (
			await (this.fetch as typeof fetch)(
				`${this.url}/${path}${
					options?.searchParams ? `?${options?.searchParams}` : ""
				}`,
				{
					method: options?.method ?? "POST",
					headers: {
						"Content-Type": options?.plainBody
							? "text/plain"
							: "application/json",
						Accept: "application/json",
						NS: this.namespace!,
						DB: this.database!,
						...(this.authorization
							? { Authorization: this.authorization }
							: {}),
					},
					body: typeof options?.body == "string"
						? options?.body
						: JSON.stringify(options?.body),
				},
			)
		).json() as T;
	}
}
