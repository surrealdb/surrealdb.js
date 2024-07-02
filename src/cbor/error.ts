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

export class CborPartialDisabled extends CborError {
	name = "CborPartialDisabled";
	constructor() {
		super(
			"Tried to insert a Gap into a CBOR value, while partial mode is not enabled",
		);
	}
}

export class CborFillMissing extends CborError {
	name = "CborFillMissing";
	constructor() {
		super("Fill for a gap is missing, and gap has no default");
	}
}
