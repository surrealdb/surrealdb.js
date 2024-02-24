import { z } from "zod";
import { RecordIdValue } from "./recordid.ts";

export class Thing<Tb extends string> {
	public readonly tb: Tb;
	public readonly id?: RecordIdValue;

	constructor(tb: Tb, id?: RecordIdValue) {
		this.tb = z.string().parse(tb) as Tb;
		this.id = RecordIdValue.optional().parse(id);
	}
}
