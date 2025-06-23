import type { ConnectionController } from "../../../controller";
import { output } from "../../../internal/output";
import { ConnectionPromise } from "../../../internal/promise";
import type { RecordId, RecordIdRange, Table } from "../../../value";

export class DeletePromise<T> extends ConnectionPromise<T> {
	#thing: RecordId | RecordIdRange | Table;

	constructor(
		connection: ConnectionController,
		thing: RecordId | RecordIdRange | Table,
	) {
		super(connection);
		this.#thing = thing;
	}

	protected async dispatch(): Promise<T> {
		const result = await this.rpc("delete", [this.#thing]);
		return output(this.#thing, result) as T;
	}
}
