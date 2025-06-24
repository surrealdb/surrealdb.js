import type { ConnectionController } from "../../../controller";
import { collect } from "../../../internal/collect";
import { ConnectionPromise } from "../../../internal/promise";
import type { Jsonify } from "../../../utils";
import type { RecordId, RecordIdRange, Table } from "../../../value";

/**
 * A promise representing a `delete` RPC call to the server.
 */
export class DeletePromise<T> extends ConnectionPromise<T> {
	#what: RecordId | RecordIdRange | Table;
	#json = false;

	constructor(
		connection: ConnectionController,
		what: RecordId | RecordIdRange | Table,
	) {
		super(connection);
		this.#what = what;
	}

	/**
	 * Convert the response to a JSON compatible format, ensuring that
	 * the response is serializable as a valid JSON structure.
	 */
	jsonify(): DeletePromise<Jsonify<T>> {
		this.#json = true;
		return this as DeletePromise<Jsonify<T>>;
	}

	protected async dispatch(): Promise<T> {
		const result = await this.rpc("delete", [this.#what]);

		return collect<T>(result, {
			subject: this.#what,
			json: this.#json,
		});
	}
}
