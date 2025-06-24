import type {
	MapJsonify,
	MapQueryResult,
	Prettify,
	QueryResult,
} from "../../../types";

import { type Fill, partiallyEncodeObject } from "@surrealdb/cbor";
import { REPLACER } from "../../../cbor/replacer";
import type { ConnectionController } from "../../../controller";
import { ResponseError } from "../../../errors";
import { ConnectionPromise } from "../../../internal/promise";
import { PreparedQuery, jsonify } from "../../../utils";

/**
 * A promise representing a `query` RPC call to the server.
 */
export class QueryPromise<T extends unknown[]> extends ConnectionPromise<
	Prettify<T>
> {
	#preparedOrQuery: string | PreparedQuery | undefined;
	#gapsOrBinds?: Record<string, unknown> | Fill[] | undefined;
	#raw = false;
	#json = false;

	constructor(
		connection: ConnectionController,
		preparedOrQuery: string | PreparedQuery | undefined,
		gapsOrBinds?: Record<string, unknown> | Fill[] | undefined,
	) {
		super(connection);
		this.#preparedOrQuery = preparedOrQuery;
		this.#gapsOrBinds = gapsOrBinds;
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
		let params: unknown[];

		if (this.#preparedOrQuery instanceof PreparedQuery) {
			params = [
				this.#preparedOrQuery.query,
				partiallyEncodeObject(this.#preparedOrQuery.bindings, {
					fills: this.#gapsOrBinds as Fill[],
					replacer: REPLACER.encode,
				}),
			];
		} else {
			params = [this.#preparedOrQuery, this.#gapsOrBinds];
		}

		let results = await this.rpc<QueryResult<unknown>[]>("query", params);

		if (this.#json) {
			results = results.map((result) => {
				result.result = jsonify(result.result);
				return result;
			});
		}

		if (this.#raw) {
			return results as T;
		}

		return results.map(({ status, result }) => {
			if (status === "ERR") throw new ResponseError(result);
			return result;
		}) as T;
	}
}
