import { SurrealDbError } from "../../errors";
import { Value } from "../value";

export class Table<Tb extends string = string> extends Value {
	public readonly tb: Tb;

	constructor(tb: Tb) {
		super();
		if (typeof tb !== "string")
			throw new SurrealDbError("Table must be a string");
		this.tb = tb;
	}

	equals(other: unknown): boolean {
		if (!(other instanceof Table)) return false;
		return this.tb === other.tb;
	}

	toJSON(): string {
		return this.tb;
	}

	toString(): string {
		return this.tb;
	}
}
