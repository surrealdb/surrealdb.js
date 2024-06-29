export class Table<Tb extends string = string> {
	public readonly tb: Tb;

	constructor(tb: Tb) {
		if (typeof tb !== "string") throw new Error("Table must be a string");
		this.tb = tb;
	}

	toJSON() {
		return this.tb;
	}

	toString() {
		return this.tb;
	}
}
