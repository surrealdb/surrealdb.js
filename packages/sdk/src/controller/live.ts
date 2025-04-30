import type { ConnectionController } from "./connection";

export class LiveController {
	#connection: ConnectionController;

	constructor(connection: ConnectionController) {
		this.#connection = connection;
	}
}
