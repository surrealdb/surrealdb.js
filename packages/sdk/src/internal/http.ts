import { HttpConnectionError } from "../errors";
import type { ConnectionState, DriverContext } from "../types/surreal";

export interface FetchSurrealOptions {
	body?: unknown;
	url?: URL;
	headers?: Record<string, string>;
	method?: string;
}

export async function fetchSurreal(
	context: DriverContext,
	state: ConnectionState,
	options: FetchSurrealOptions,
): Promise<Uint8Array> {
	const endpoint = new URL(options.url ?? state.url);
	const headerMap: Record<string, string> = {
		"Content-Type": "application/cbor",
		Accept: "application/cbor",
		...options.headers,
	};

	if (state.namespace) {
		headerMap["Surreal-NS"] = state.namespace;
	}

	if (state.database) {
		headerMap["Surreal-DB"] = state.database;
	}

	if (state.accessToken) {
		headerMap.Authorization = `Bearer ${state.accessToken}`;
	}

	endpoint.protocol = endpoint.protocol.replace("ws", "http");

	const raw = await fetch(endpoint, {
		method: options.method ?? "POST",
		headers: headerMap,
		body: options.body ? context.encode(options.body) : undefined,
	});

	const buffer = await raw.arrayBuffer();

	if (raw.status === 200) {
		return new Uint8Array(buffer);
	}

	const dec = new TextDecoder("utf-8");

	throw new HttpConnectionError(dec.decode(buffer), raw.status, raw.statusText, buffer);
}

export function parseEndpoint(value: string | URL): URL {
	const url = new URL(value);

	if (!url.pathname.endsWith("/rpc")) {
		if (!url.pathname.endsWith("/")) url.pathname += "/";
		url.pathname += "rpc";
	}

	return url;
}
