import { ZodType, ZodTypeDef, z } from "npm:zod@^3.22.4";
import { RecordId } from "../data/recordid.ts";
import { Duration } from "../data/duration.ts";
import { Decimal } from "../data/decimal.ts";
import { Uuid } from "../data/uuid.ts";

export const recordId = <
	Tb extends string,
>(tb?: Tb) => {
	let t = z.instanceof(RecordId);
	if (tb) t = t.refine(
		v => v.tb == tb,
		v => ({
			message: `Expected Record ID to be part of table "${tb}", but found "${v.tb}"`
		})
	);

	return t as ZodType<RecordId<Tb>, ZodTypeDef, RecordId<Tb>>;
}


export const duration = z.instanceof(Duration);
export const decimal = z.instanceof(Decimal);
export const uuid = z.instanceof(Uuid);
export const none = z.undefined;

export * from 'npm:zod@^3.22.4';
