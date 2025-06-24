import type { ConnectionController } from "../../../controller";
import { output } from "../../../internal/output";
import { ConnectionPromise } from "../../../internal/promise";
import type { Doc } from "../../../types";
import type { RecordId, Table } from "../../../value";

/**
 * A promise representing a `create` RPC call to the server.
 */
export class CreatePromise<T, U extends Doc> extends ConnectionPromise<T> {
	#what: RecordId | Table;
	#data?: U;

	constructor(
		connection: ConnectionController,
		what: RecordId | Table,
		data?: U,
	) {
		super(connection);
		this.#what = what;
		this.#data = data;
	}

	protected async dispatch(): Promise<T> {
		const result = await this.rpc("create", [this.#what, this.#data]);
		return output(this.#what, result) as T;
	}
}
