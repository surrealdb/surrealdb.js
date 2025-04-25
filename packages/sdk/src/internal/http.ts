import { HttpConnectionError } from "../errors";

export interface Connection {
	url: URL;
	namespace: string;
	database: string;
	token: string;
}

export async function postConnection(
	connection: Connection,
	body: unknown,
	url?: URL,
	headers?: Record<string, string>,
): Promise<ArrayBuffer> {
	const headerMap: Record<string, string> = {
		"Content-Type": "application/cbor",
		Accept: "application/cbor",
		...headers,
	};

	if (connection.namespace) {
		headerMap["Surreal-NS"] = connection.namespace;
	}

	if (connection.database) {
		headerMap["Surreal-DB"] = connection.database;
	}

	if (connection.token) {
		headerMap.Authorization = `Bearer ${connection.token}`;
	}

	const raw = await fetch(url ?? connection.url, {
		method: "POST",
		headers: headerMap,
		body: this.encodeCbor(body),
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
