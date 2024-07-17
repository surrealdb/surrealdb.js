import {
	ConnectionUnavailable,
	HttpConnectionError,
	MissingNamespaceDatabase,
} from "../errors";
import type { RpcRequest, RpcResponse } from "../types";
import { getIncrementalID } from "../util/getIncrementalID";
import { retrieveRemoteVersion } from "../util/versionCheck";
import {
	AbstractEngine,
	ConnectionStatus,
	type EngineEvents,
} from "./abstract";

export class HttpEngine extends AbstractEngine {
	connection: {
		url: URL | undefined;
		namespace: string | undefined;
		database: string | undefined;
		token: string | undefined;
		variables: Record<string, unknown>;
	} = {
		url: undefined,
		namespace: undefined,
		database: undefined,
		token: undefined,
		variables: {},
	};

	private setStatus<T extends ConnectionStatus>(
		status: T,
		...args: EngineEvents[T]
	) {
		this.status = status;
		this.emitter.emit(status, args);
	}

	version(url: URL, timeout?: number): Promise<string> {
		return retrieveRemoteVersion(url, timeout);
	}

	connect(url: URL): Promise<void> {
		this.setStatus(ConnectionStatus.Connecting);
		this.connection.url = url;
		this.setStatus(ConnectionStatus.Connected);
		this.ready = new Promise<void>((r) => r());
		return this.ready;
	}

	disconnect(): Promise<void> {
		this.connection = {
			url: undefined,
			namespace: undefined,
			database: undefined,
			token: undefined,
			variables: {},
		};

		this.ready = undefined;
		this.setStatus(ConnectionStatus.Disconnected);
		return new Promise<void>((r) => r());
	}

	async rpc<
		Method extends string,
		Params extends unknown[] | undefined,
		Result,
	>(request: RpcRequest<Method, Params>): Promise<RpcResponse<Result>> {
		await this.ready;
		if (!this.connection.url) {
			throw new ConnectionUnavailable();
		}

		if (request.method === "use") {
			const [ns, db] = request.params as [
				string | false | undefined,
				string | false | undefined,
			];

			if (ns === false) this.connection.namespace = undefined;
			if (db === false) this.connection.database = undefined;
			if (ns) this.connection.namespace = ns;
			if (db) this.connection.database = db;
			return {
				result: true as Result,
			};
		}

		if (request.method === "let") {
			const [key, value] = request.params as [string, unknown];
			this.connection.variables[key] = value;
			return {
				result: true as Result,
			};
		}

		if (request.method === "unset") {
			const [key] = request.params as [string];
			delete this.connection.variables[key];
			return {
				result: true as Result,
			};
		}

		if (request.method === "query") {
			request.params = [
				request.params?.[0],
				{
					...this.connection.variables,
					...(request.params?.[1] ?? {}),
				},
			] as Params;
		}

		if (!this.connection.namespace || !this.connection.database) {
			throw new MissingNamespaceDatabase();
		}

		const id = getIncrementalID();
		const raw = await fetch(`${this.connection.url}`, {
			method: "POST",
			headers: {
				"Content-Type": "application/cbor",
				Accept: "application/cbor",
				"Surreal-NS": this.connection.namespace,
				"Surreal-DB": this.connection.database,
				...(this.connection.token
					? { Authorization: `Bearer ${this.connection.token}` }
					: {}),
			},
			body: this.encodeCbor({ id, ...request }),
		});

		const buffer = await raw.arrayBuffer();

		if (raw.status === 200) {
			const response: RpcResponse = this.decodeCbor(buffer);
			if ("result" in response) {
				switch (request.method) {
					case "signin":
					case "signup": {
						this.connection.token = response.result as string;
						break;
					}

					case "authenticate": {
						const [token] = request.params as [string];
						this.connection.token = token;
						break;
					}

					case "invalidate": {
						this.connection.token = undefined;
						break;
					}
				}
			}

			this.emitter.emit(`rpc-${id}`, [response]);
			return response as RpcResponse<Result>;
		}

		const dec = new TextDecoder("utf-8");
		throw new HttpConnectionError(
			dec.decode(buffer),
			raw.status,
			raw.statusText,
			buffer,
		);
	}

	get connected(): boolean {
		return !!this.connection.url;
	}
}
