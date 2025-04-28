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

	if (state.token) {
		headerMap.Authorization = `Bearer ${state.token}`;
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
