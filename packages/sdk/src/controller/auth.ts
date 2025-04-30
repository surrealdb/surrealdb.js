import type { ConnectionController } from "./connection";

export class AuthController {
	#connection: ConnectionController;

	constructor(connection: ConnectionController) {
		this.#connection = connection;
	}
}
