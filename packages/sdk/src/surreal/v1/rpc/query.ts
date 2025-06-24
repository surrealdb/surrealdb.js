import { type Fill, partiallyEncodeObject } from "@surrealdb/cbor";
import { REPLACER } from "../../../cbor/replacer";
import type { ConnectionController } from "../../../controller";
import { ResponseError } from "../../../errors";
import { ConnectionPromise } from "../../../internal/promise";
import type { MapQueryResult, Prettify } from "../../../types";
import { PreparedQuery } from "../../../utils";

/**
 * A promise representing a `query` RPC call to the server.
 */
export class QueryPromise<T extends unknown[]> extends ConnectionPromise<
	Prettify<T>
> {
	#preparedOrQuery: string | PreparedQuery | undefined;
	#gapsOrBinds?: Record<string, unknown> | Fill[] | undefined;
	#raw = false;

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

		const results = await this.rpc<MapQueryResult<T>>("query", params);

		if (this.#raw) {
			return results as T;
		}

		return results.map(({ status, result }) => {
			if (status === "ERR") throw new ResponseError(result);
			return result;
		}) as T;
	}
}
