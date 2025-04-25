import { ConnectionUnavailable } from "../errors";
import type { ExportOptions } from "../types/export";
import type { RpcRequest, RpcResponse } from "../types/rpc";
import type { EngineEvents, SurrealEngine } from "../types/surreal";
import { Publisher } from "../utils/publisher";
import { retrieveRemoteVersion } from "../utils/version";

const ALWAYS_ALLOW = new Set([
	"signin",
	"signup",
	"authenticate",
	"invalidate",
	"version",
	"use",
	"let",
	"unset",
	"query",
]);

export class HttpEngine implements SurrealEngine {
	#publisher = new Publisher<EngineEvents>();
	#endpoint: URL | undefined;

	subscribe: SurrealEngine["subscribe"] = this.#publisher.subscribe;

	async open(url: URL): Promise<void> {
		this.#publisher.publish("connecting");
		this.#endpoint = url;
		this.#publisher.publish("connected");
	}

	async close(): Promise<void> {
		this.#endpoint = undefined;
		this.#publisher.publish("disconnected");
	}

	async version(timeout?: number): Promise<string> {
		if (!this.#endpoint) {
			throw new ConnectionUnavailable();
		}

		return retrieveRemoteVersion(this.#endpoint, timeout);
	}

	async import(data: string): Promise<void> {
		if (!this.#endpoint) {
			throw new ConnectionUnavailable();
		}

		const endpoint = new URL(this.#endpoint);
		const basepath = endpoint.pathname.slice(0, -4);

		endpoint.pathname = `${basepath}/import`;

		await this.req_post(data, url, {
			Accept: "application/json",
		});
	}

	export(options?: Partial<ExportOptions>): Promise<string> {}

	rpc<Method extends string, Params extends unknown[] | undefined, Result>(
		request: RpcRequest<Method, Params>,
		force?: boolean,
	): Promise<RpcResponse<Result>> {}

	// version(url: URL, timeout?: number): Promise<string> {
	// 	return retrieveRemoteVersion(url, timeout);
	// }
	// async connect(url: URL): Promise<void> {
	// 	this.setStatus(ConnectionStatus.Connecting);
	// 	this.connection.url = url;
	// 	await this.context.prepare?.(new EngineAuth(this));
	// 	this.setStatus(ConnectionStatus.Connected);
	// 	this.ready = new Promise<void>((r) => r());
	// 	return this.ready;
	// }
	// disconnect(): Promise<void> {
	// 	this.connection = {
	// 		url: undefined,
	// 		namespace: undefined,
	// 		database: undefined,
	// 		token: undefined,
	// 		variables: {},
	// 	};
	// 	this.ready = undefined;
	// 	this.setStatus(ConnectionStatus.Disconnected);
	// 	return new Promise<void>((r) => r());
	// }
	// async rpc<
	// 	Method extends string,
	// 	Params extends unknown[] | undefined,
	// 	Result,
	// >(
	// 	request: RpcRequest<Method, Params>,
	// 	force?: boolean,
	// ): Promise<RpcResponse<Result>> {
	// 	if (!force) await this.ready;
	// 	if (!this.connection.url) throw new ConnectionUnavailable();
	// 	if (
	// 		(!this.connection.namespace || !this.connection.database) &&
	// 		!ALWAYS_ALLOW.has(request.method)
	// 	) {
	// 		throw new MissingNamespaceDatabase();
	// 	}
	// 	if (request.method === "use") {
	// 		const [ns, db] = request.params as [
	// 			string | null | undefined,
	// 			string | null | undefined,
	// 		];
	// 		if (ns === null) this.connection.namespace = undefined;
	// 		if (db === null) this.connection.database = undefined;
	// 		if (ns) this.connection.namespace = ns;
	// 		if (db) this.connection.database = db;
	// 		return {
	// 			result: true as Result,
	// 		};
	// 	}
	// 	if (request.method === "let") {
	// 		const [key, value] = request.params as [string, unknown];
	// 		this.connection.variables[key] = value;
	// 		return {
	// 			result: true as Result,
	// 		};
	// 	}
	// 	if (request.method === "unset") {
	// 		const [key] = request.params as [string];
	// 		delete this.connection.variables[key];
	// 		return {
	// 			result: true as Result,
	// 		};
	// 	}
	// 	if (request.method === "query") {
	// 		request.params = [
	// 			request.params?.[0],
	// 			{
	// 				...this.connection.variables,
	// 				...(request.params?.[1] ?? {}),
	// 			},
	// 		] as Params;
	// 	}
	// 	const id = getIncrementalID();
	// 	const buffer = await this.req_post({ id, ...request });
	// 	const response: RpcResponse = this.decodeCbor(buffer);
	// 	if ("result" in response) {
	// 		switch (request.method) {
	// 			case "signin":
	// 			case "signup": {
	// 				this.connection.token = response.result as string;
	// 				break;
	// 			}
	// 			case "authenticate": {
	// 				const [token] = request.params as [string];
	// 				this.connection.token = token;
	// 				break;
	// 			}
	// 			case "invalidate": {
	// 				this.connection.token = undefined;
	// 				break;
	// 			}
	// 		}
	// 	}
	// 	this.emitter.emit(`rpc-${id}`, [response]);
	// 	return response as RpcResponse<Result>;
	// }
	// get connected(): boolean {
	// 	return !!this.connection.url;
	// }
	// async export(options?: Partial<ExportOptions>): Promise<string> {
	// 	if (!this.connection.url) {
	// 		throw new ConnectionUnavailable();
	// 	}
	// 	const url = new URL(this.connection.url);
	// 	const basepath = url.pathname.slice(0, -4);
	// 	url.pathname = `${basepath}/export`;
	// 	const buffer = await this.req_post(options ?? {}, url, {
	// 		Accept: "plain/text",
	// 	});
	// 	const dec = new TextDecoder("utf-8");
	// 	return dec.decode(buffer);
	// }
	// async import(data: string): Promise<void> {
	// 	if (!this.connection.url) {
	// 		throw new ConnectionUnavailable();
	// 	}
	// 	const url = new URL(this.connection.url);
	// 	const basepath = url.pathname.slice(0, -4);
	// 	url.pathname = `${basepath}/import`;
	// 	await this.req_post(data, url, {
	// 		Accept: "application/json",
	// 	});
	// }
}
