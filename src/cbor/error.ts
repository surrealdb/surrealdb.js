import { SurrealDbError } from "../errors";

export abstract class CborError extends SurrealDbError {
	abstract readonly name: string;
	readonly message: string;

	constructor(message: string) {
		super();
		this.message = message;
	}
}

export class CborNumberError extends CborError {
	name = "CborNumberError";
}

export class CborRangeError extends CborError {
	name = "CborRangeError";
}

export class CborInvalidMajorError extends CborError {
	name = "CborInvalidMajorError";
}

export class CborBreak extends CborError {
	name = "CborBreak";
	constructor() {
		super("Came across a break which was not intercepted by the decoder");
	}
}
