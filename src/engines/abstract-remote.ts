import { HttpConnectionError } from "../errors";
import { AbstractEngine } from "./abstract";

export abstract class AbstractRemoteEngine extends AbstractEngine {
	protected async req_post(
		body: unknown,
		url?: URL,
		headers_?: Record<string, string>,
	): Promise<ArrayBuffer> {
		const headers: Record<string, string> = {
			"Content-Type": "application/cbor",
			Accept: "application/cbor",
			...headers_,
		};

		if (this.connection.namespace) {
			headers["Surreal-NS"] = this.connection.namespace;
		}

		if (this.connection.database) {
			headers["Surreal-DB"] = this.connection.database;
		}

		if (this.connection.token) {
			headers.Authorization = `Bearer ${this.connection.token}`;
		}

		const raw = await fetch(`${url ?? this.connection.url}`, {
			method: "POST",
			headers,
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
}
