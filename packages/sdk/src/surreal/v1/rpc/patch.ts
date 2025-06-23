import type { ConnectionController } from "../../../controller";
import { output } from "../../../internal/output";
import { ConnectionPromise } from "../../../internal/promise";
import type { Patch } from "../../../types";
import type { RecordId, RecordIdRange, Table } from "../../../value";

export class PatchPromise<T> extends ConnectionPromise<T> {
	#what: RecordId | RecordIdRange | Table;
	#data?: Patch[];
	#diff?: boolean;

	constructor(
		connection: ConnectionController,
		what: RecordId | RecordIdRange | Table,
		data?: Patch[],
		diff?: boolean,
	) {
		super(connection);
		this.#what = what;
		this.#data = data;
		this.#diff = diff;
	}

	protected async dispatch(): Promise<T> {
		const result = await this.rpc("patch", [
			this.#what,
			this.#data,
			this.#diff,
		]);
		return this.#diff ? (result as T) : (output(this.#what, result) as T);
	}
}
