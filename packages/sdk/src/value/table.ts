import { SurrealError } from "../errors";
import { escapeIdent } from "../utils";
import { Value } from "./value";

/**
 * A SurrealQL table value.
 */
export class Table<Tb extends string = string> extends Value {
	public readonly name: Tb;

	constructor(tb: Tb) {
		super();
		if (typeof tb !== "string")
			throw new SurrealError("Table must be a string");
		this.name = tb;
	}

	equals(other: unknown): boolean {
		if (!(other instanceof Table)) return false;
		return this.name === other.name;
	}

	toJSON(): string {
		return this.toString();
	}

	toString(): string {
		return escapeIdent(this.name);
	}
}
