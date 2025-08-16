import { map } from "rxjs";
import type { ConnectionController } from "../controller";
import type { QueryChunk } from "../types";
import { type BoundQuery, jsonify } from "../utils";
import { collectChunks } from "../utils/collect-chunks";
import type { Uuid } from "../value";
import { DispatchedPromise } from "./dispatched-promise";

function jsonifyChunk(chunk: QueryChunk<unknown>): QueryChunk<unknown> {
	if (chunk.response.success) {
		chunk.response.result = jsonify(chunk.response.result);
	}

	return chunk;
}

/**
 * A `DispatchedPromise` that is bound to a specific connection and
 * allows the execution of queries against that remote database.
 */
export abstract class QueriablePromise<T, S = false, J = false> extends DispatchedPromise<T> {
	#stream = false;
	#json = false;
	#txn: Uuid | undefined;

	protected _connection: ConnectionController;

	protected abstract build(): BoundQuery;

	constructor(connection: ConnectionController) {
		super();
		this._connection = connection;
	}

	/**
	 * Append this query to a specific transaction.
	 *
	 * **NOTE**: This functionality is not yet used by SurrealDB.
	 *
	 * @param txn The unique transaction identifier.
	 * @returns self
	 */
	txn(txn: Uuid): QueriablePromise<T, S, J> {
		this.#txn = txn;
		return this as unknown as QueriablePromise<T, S, J>;
	}

	/**
	 * Returns a stream of responses and results from the remote database.
	 * @returns self
	 */
	stream(): QueriablePromise<T, true, J> {
		this.#stream = true;
		return this as unknown as QueriablePromise<T, true, J>;
	}

	/**
	 * Convert the response to a JSON compatible format, ensuring that
	 * the response is serializable as a valid JSON structure.
	 * @returns self
	 */
	jsonify(): QueriablePromise<T, S, true> {
		this.#json = true;
		return this as QueriablePromise<T, S, true>;
	}

	protected override async dispatch(): Promise<T> {
		await this._connection.ready();
		const { query, bindings } = this.build();

		let response = await this._connection.query(query, bindings);

		if (this.#json) {
			response = response.pipe(map(jsonifyChunk));
		}

		if (this.#stream) {
			return response;
		}

		return collectChunks(response);
	}
}
