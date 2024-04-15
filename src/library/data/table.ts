import { z } from "zod";

export class Table<Tb extends string = string> {
	public readonly tb: Tb;

	constructor(tb: Tb) {
		this.tb = z.string().parse(tb) as Tb;
	}

	toJSON() {
		return {
			tb: this.tb,
		}
	}
}
