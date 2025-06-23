import type { ConnectionController } from "../../../controller";
import { output } from "../../../internal/output";
import { ConnectionPromise } from "../../../internal/promise";
import type { Doc } from "../../../types";
import type { RecordId, RecordIdRange, Table } from "../../../value";

export class MergePromise<T, U extends Doc> extends ConnectionPromise<T> {
	#thing: RecordId | RecordIdRange | Table;
	#data?: U;

	constructor(
		connection: ConnectionController,
		thing: RecordId | RecordIdRange | Table,
		data?: U,
	) {
		super(connection);
		this.#thing = thing;
		this.#data = data;
	}

	protected async dispatch(): Promise<T> {
		const result = await this.rpc("merge", [this.#thing, this.#data]);
		return output(this.#thing, result) as T;
	}
}
