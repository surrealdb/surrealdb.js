import type { ConnectionController } from "../../../controller";
import { output } from "../../../internal/output";
import { ConnectionPromise } from "../../../internal/promise";
import type { Doc, RelateInOut } from "../../../types";
import type { RecordId, Table } from "../../../value";

/**
 * A promise representing a `relate` RPC call to the server.
 */
export class RelatePromise<T, U extends Doc> extends ConnectionPromise<T> {
	#from: RelateInOut;
	#thing: Table | RecordId;
	#to: RelateInOut;
	#data?: U;

	constructor(
		connection: ConnectionController,
		from: RelateInOut,
		thing: Table | RecordId,
		to: RelateInOut,
		data?: U,
	) {
		super(connection);
		this.#from = from;
		this.#thing = thing;
		this.#to = to;
		this.#data = data;
	}

	protected async dispatch(): Promise<T> {
		const result = await this.rpc("relate", [
			this.#from,
			this.#thing,
			this.#to,
			this.#data,
		]);

		return output(this.#thing, result) as T;
	}
}
