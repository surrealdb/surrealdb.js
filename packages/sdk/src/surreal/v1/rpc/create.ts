import type { ConnectionController } from "../../../controller";
import { collect } from "../../../internal/collect";
import { ConnectionPromise } from "../../../internal/promise";
import type { Doc } from "../../../types";
import type { Jsonify } from "../../../utils";
import type { RecordId, Table } from "../../../value";

/**
 * A promise representing a `create` RPC call to the server.
 */
export class CreatePromise<T, U extends Doc> extends ConnectionPromise<T> {
	#what: RecordId | Table;
	#data?: U;
	#json = false;

	constructor(
		connection: ConnectionController,
		what: RecordId | Table,
		data?: U,
	) {
		super(connection);
		this.#what = what;
		this.#data = data;
	}

	/**
	 * Convert the response to a JSON compatible format, ensuring that
	 * the response is serializable as a valid JSON structure.
	 */
	jsonify(): CreatePromise<Jsonify<T>, U> {
		this.#json = true;
		return this as CreatePromise<Jsonify<T>, U>;
	}

	protected async dispatch(): Promise<T> {
		const result = await this.rpc("create", [this.#what, this.#data]);

		return collect<T>(result, {
			subject: this.#what,
			json: this.#json,
		});
	}
}
