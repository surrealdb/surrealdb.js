import { ConnectionUnavailable, MissingNamespaceDatabase } from "../errors";
import { getIncrementalID } from "../internal/get-incremental-id";
import { postEndpoint } from "../internal/http";
import { Publisher } from "../internal/publisher";
import type { ExportOptions } from "../types/export";
import type { RpcRequest, RpcResponse } from "../types/rpc";
import type {
	ConnectionState,
	DriverContext,
	EngineEvents,
	SurrealEngine,
} from "../types/surreal";

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

/**
 * An engine that communicates by sending individual HTTP requests
 */
export class HttpEngine implements SurrealEngine {
	#publisher = new Publisher<EngineEvents>();
	#state: ConnectionState | undefined;
	#context: DriverContext;

	subscribe: SurrealEngine["subscribe"] = this.#publisher.subscribe;

	constructor(context: DriverContext) {
		this.#context = context;
	}

	async open(state: ConnectionState): Promise<void> {
		this.#publisher.publish("connecting");
		this.#state = state;
		this.#publisher.publish("connected");
	}

	async close(): Promise<void> {
		this.#state = undefined;
		this.#publisher.publish("disconnected");
	}

	async import(data: string): Promise<void> {
		if (!this.#state) {
			throw new ConnectionUnavailable();
		}

		const endpoint = new URL(this.#state.url);
		const basepath = endpoint.pathname.slice(0, -4);

		endpoint.pathname = `${basepath}/import`;

		await postEndpoint(this.#context, this.#state, data, endpoint, {
			Accept: "application/json",
		});
	}

	async export(options?: Partial<ExportOptions>): Promise<string> {
		if (!this.#state) {
			throw new ConnectionUnavailable();
		}

		const endpoint = new URL(this.#state.url);
		const basepath = endpoint.pathname.slice(0, -4);

		endpoint.pathname = `${basepath}/export`;

		const buffer = await postEndpoint(
			this.#context,
			this.#state,
			options ?? {},
			endpoint,
			{
				Accept: "plain/text",
			},
		);

		return new TextDecoder("utf-8").decode(buffer);
	}

	async send<
		Method extends string,
		Params extends unknown[] | undefined,
		Result,
	>(request: RpcRequest<Method, Params>): Promise<RpcResponse<Result>> {
		if (!this.#state) {
			throw new ConnectionUnavailable();
		}

		if (
			(!this.#state.namespace || !this.#state.database) &&
			!ALWAYS_ALLOW.has(request.method)
		) {
			throw new MissingNamespaceDatabase();
		}

		const id = getIncrementalID();
		const buffer = await postEndpoint(this.#context, this.#state, {
			id,
			...request,
		});

		return this.#context.decode<RpcResponse<Result>>(buffer);
	}
}
