import type { ConnectionController } from "../../../controller";
import { NoTokenReturned } from "../../../errors";
import { ConnectionPromise } from "../../../internal/promise";
import type { AccessRecordAuth, Token } from "../../../types";

export class SignupPromise extends ConnectionPromise<Token> {
	#auth: AccessRecordAuth;

	constructor(connection: ConnectionController, auth: AccessRecordAuth) {
		super(connection);
		this.#auth = auth;
	}

	protected async dispatch(): Promise<Token> {
		const converted = this._connection.buildAuth(this.#auth);
		const result = await this.rpc<Token>("signup", [converted]);

		if (!result) throw new NoTokenReturned();

		return result;
	}
}
