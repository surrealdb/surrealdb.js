import type { ConnectionController } from "../controller";
import { SurrealError } from "../errors";
import { ConnectionPromise } from "../internal/promise";
import type { MapJsonify, MapQueryResult, Prettify, QueryResult } from "../types";
import { BoundQuery, jsonify } from "../utils";

/**
 * A promise representing a `query` RPC call to the server.
 */
export class QueryPromise<T extends unknown[]> extends ConnectionPromise<Prettify<T>> {
	#query: string;
	#bindings: Record<string, unknown> | undefined;
	#raw = false;
	#json = false;

	constructor(
		connection: ConnectionController,
		query: string | BoundQuery,
		bindings?: Record<string, unknown>,
	) {
		super(connection);

		if (query instanceof BoundQuery) {
			this.#query = query.query;
			this.#bindings = query.bindings;
		} else {
			this.#query = query;
			this.#bindings = bindings;
		}
	}

	/**
	 * Return the raw result of each response, including status, result, and error.
	 * This will also prevent the query function from throwing an error if any
	 * of the responses contain an error, instead leaving it to you to handle
	 * the error.
	 */
	raw(): QueryPromise<MapQueryResult<T>> {
		this.#raw = true;
		return this as unknown as QueryPromise<MapQueryResult<T>>;
	}

	/**
	 * Convert the response to a JSON compatible format, ensuring that
	 * the response is serializable as a valid JSON structure.
	 */
	jsonify(): QueryPromise<MapJsonify<T>> {
		this.#json = true;
		return this as QueryPromise<MapJsonify<T>>;
	}

	protected async dispatch(): Promise<Prettify<T>> {
		let results = await this.rpc<QueryResult<unknown>[]>("query", [this.#query, this.#bindings]);

		if (this.#json) {
			results = results.map((result) => {
				result.result = jsonify(result.result);
				return result;
			});
		}

		if (this.#raw) {
			return results as T;
		}

		return results.map((res) => {
			if (res.status === "ERR") throw new SurrealError(res.result);
			return res.result;
		}) as T;
	}
}
