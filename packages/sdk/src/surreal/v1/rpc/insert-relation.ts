import type { ConnectionController } from "../../../controller";
import { ConnectionPromise } from "../../../internal/promise";
import type { Doc } from "../../../types";
import type { Table } from "../../../value";

/**
 * A promise representing an `insert_relation` RPC call to the server.
 */
export class InsertRelationPromise<
	T,
	U extends Doc,
> extends ConnectionPromise<T> {
	#arg1: Table | U | U[];
	#arg2?: U | U[];

	constructor(
		connection: ConnectionController,
		arg1: Table | U | U[],
		arg2?: U | U[],
	) {
		super(connection);
		this.#arg1 = arg1;
		this.#arg2 = arg2;
	}

	protected async dispatch(): Promise<T> {
		const params =
			this.#arg1 instanceof Object && "name" in this.#arg1
				? [this.#arg1, this.#arg2]
				: [undefined, this.#arg1];

		return await this.rpc("insert_relation", params);
	}
}
