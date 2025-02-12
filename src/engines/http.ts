import { ConnectionUnavailable, MissingNamespaceDatabase } from "../errors";
import type { ExportOptions, RpcRequest, RpcResponse } from "../types";
import { getIncrementalID } from "../util/get-incremental-id";
import { retrieveRemoteVersion } from "../util/version-check";
import {
	AbstractEngine,
	ConnectionStatus,
	type EngineEvents,
} from "./abstract";

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

		if (
			(!this.connection.namespace || !this.connection.database) &&
			!ALWAYS_ALLOW.has(request.method)
		) {
			throw new MissingNamespaceDatabase();
		}

		if (request.method === "use") {
			const [ns, db] = request.params as [
				string | null | undefined,
				string | null | undefined,
			];

			if (ns === null) this.connection.namespace = undefined;
			if (db === null) this.connection.database = undefined;
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

		const id = getIncrementalID();
		const buffer = await this.req_post({ id, ...request });
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

	get connected(): boolean {
		return !!this.connection.url;
	}

	async export(options?: Partial<ExportOptions>): Promise<string> {
		if (!this.connection.url) {
			throw new ConnectionUnavailable();
		}
		const url = new URL(this.connection.url);
		const basepath = url.pathname.slice(0, -4);
		url.pathname = `${basepath}/export`;

		const buffer = await this.req_post(options ?? {}, url, {
			Accept: "plain/text",
		});

		const dec = new TextDecoder("utf-8");
		return dec.decode(buffer);
	}

	async import(data: string): Promise<void> {
		if (!this.connection.url) {
			throw new ConnectionUnavailable();
		}
		const url = new URL(this.connection.url);
		const basepath = url.pathname.slice(0, -4);
		url.pathname = `${basepath}/import`;

		await this.req_post(data, url, {
			Accept: "application/json",
		});
	}
}
