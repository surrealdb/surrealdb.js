import { SurrealDbError } from "../../errors";

export class Table<Tb extends string = string> {
	public readonly tb: Tb;

	constructor(tb: Tb) {
		if (typeof tb !== "string")
			throw new SurrealDbError("Table must be a string");
		this.tb = tb;
	}

	toJSON(): string {
		return this.tb;
	}

	toString(): string {
		return this.tb;
	}
}
