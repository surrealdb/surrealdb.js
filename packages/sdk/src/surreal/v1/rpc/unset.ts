import type { ConnectionController } from "../../../controller";
import { ConnectionPromise } from "../../../internal/promise";

export class UnsetPromise extends ConnectionPromise<true> {
	#variable: string;

	constructor(connection: ConnectionController, variable: string) {
		super(connection);
		this.#variable = variable;
	}

	protected async dispatch(): Promise<true> {
		await this.rpc("unset", [this.#variable]);
		return true;
	}
}
