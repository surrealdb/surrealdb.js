import { z } from "npm:zod@^3.22.4";

export const RecordIdValue = z.union([
	z.string(),
	z.number(),
	z.record(z.unknown()),
	z.array(z.unknown()),
]);

export type RecordIdValue = z.infer<typeof RecordIdValue>;

export class RecordId<Tb extends string = string> {
	public readonly tb: Tb;
	public readonly id: RecordIdValue;

	constructor(tb: Tb, id: RecordIdValue) {
		this.tb = z.string().parse(tb) as Tb;
		this.id = RecordIdValue.parse(id);
	}
}
