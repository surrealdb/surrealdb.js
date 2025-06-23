import type { ConnectionController } from "../../../controller";
import { NoTokenReturned } from "../../../errors";
import { ConnectionPromise } from "../../../internal/promise";
import type { AnyAuth, Token } from "../../../types";

export class SigninPromise extends ConnectionPromise<Token> {
	#auth: AnyAuth;

	constructor(connection: ConnectionController, auth: AnyAuth) {
		super(connection);
		this.#auth = auth;
	}

	protected async dispatch(): Promise<Token> {
		const converted = this._connection.buildAuth(this.#auth);
		const result = await this.rpc<Token>("signin", [converted]);

		if (!result) throw new NoTokenReturned();

		return result;
	}
}
