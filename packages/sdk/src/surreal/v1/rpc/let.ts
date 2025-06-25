import type { ConnectionController } from "../../../controller";
import { ConnectionPromise } from "../../../internal/promise";

/**
 * A promise representing a `let` RPC call to the server.
 */
export class LetPromise extends ConnectionPromise<true> {
	#variable: string;
	#value: unknown;

	constructor(
		connection: ConnectionController,
		variable: string,
		value: unknown,
	) {
		super(connection);
		this.#variable = variable;
		this.#value = value;
	}

	protected async dispatch(): Promise<true> {
		await this.rpc("let", [this.#variable, this.#value]);
		return true;
	}
}
