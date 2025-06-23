import type { ConnectionController } from "../../../controller";
import { output } from "../../../internal/output";
import { ConnectionPromise } from "../../../internal/promise";
import type { RecordId, RecordIdRange, Table } from "../../../value";

export class SelectPromise<T> extends ConnectionPromise<T> {
	#what: RecordId | RecordIdRange | Table;

	constructor(
		connection: ConnectionController,
		what: RecordId | RecordIdRange | Table,
	) {
		super(connection);
		this.#what = what;
	}

	protected async dispatch(): Promise<T> {
		const result = await this.rpc("select", [this.#what]);
		return output(this.#what, result) as T;
	}
}
