import { z } from "npm:zod@^3.22.4";
import { RecordIdValue } from "./recordid.ts";

export class Thing<Tb extends string> {
	public readonly tb: Tb;
	public readonly id?: RecordIdValue;

	constructor(tb: Tb, id?: RecordIdValue) {
		this.tb = z.string().parse(tb) as Tb;
		this.id = RecordIdValue.optional().parse(id);
	}
}
