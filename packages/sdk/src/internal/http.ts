import { HttpConnectionError } from "../errors";
import type { ConnectionState, DriverContext } from "../types/surreal";

export async function postEndpoint(
	context: DriverContext,
	state: ConnectionState,
	body: unknown,
	url?: URL,
	headers?: Record<string, string>,
): Promise<ArrayBuffer> {
	const headerMap: Record<string, string> = {
		"Content-Type": "application/cbor",
		Accept: "application/cbor",
		...headers,
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

	const raw = await fetch(url ?? state.url, {
		method: "POST",
		headers: headerMap,
		body: context.encode(body),
	});

	const buffer = await raw.arrayBuffer();

	if (raw.status === 200) {
		return buffer;
	}

	const dec = new TextDecoder("utf-8");

	throw new HttpConnectionError(
		dec.decode(buffer),
		raw.status,
		raw.statusText,
		buffer,
	);
}

export function parseEndpoint(value: string | URL): URL {
	const url = new URL(value);

	if (!url.pathname.endsWith("/rpc")) {
		if (!url.pathname.endsWith("/")) url.pathname += "/";
		url.pathname += "rpc";
	}

	return url;
}
