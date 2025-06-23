import type { ConnectionController } from "../../../controller";
import { ConnectionPromise } from "../../../internal/promise";
import type { Token } from "../../../types";

export class AuthenticatePromise extends ConnectionPromise<true> {
	#token: Token;

	constructor(connection: ConnectionController, token: Token) {
		super(connection);
		this.#token = token;
	}

	protected async dispatch(): Promise<true> {
		await this.rpc<string>("authenticate", [this.#token]);
		return true;
	}
}
