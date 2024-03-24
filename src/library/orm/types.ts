import { ZodType, z, ParseInput, ParseReturnType, ZodTypeDef, addIssueToContext, ZodIssueCode, INVALID } from "zod";
import { RecordId } from "../data/recordid.ts";
import { Duration } from "../data/duration.ts";
import { Decimal } from "../data/decimal.ts";
import { Uuid } from "../data/uuid.ts";

export interface ZodRecordIdDef<Tb extends string> extends ZodTypeDef {
	tb?: Tb;
}

export class ZodRecordId<Tb extends string> extends ZodType<RecordId<Tb>, ZodRecordIdDef<Tb>> {
	_parse(input: ParseInput): ParseReturnType<RecordId<Tb>> {
		if (!(input.data instanceof RecordId)) {
			const ctx = this._getOrReturnCtx(input);
			addIssueToContext(
				ctx,
				{
					code: ZodIssueCode.custom,
					message: `Expected input to be instance of RecordId, but found a value of type ${typeof input.data}`
				}
			);

			return INVALID;
		}

		if (this._def.tb && input.data.tb !== this._def.tb) {
			const ctx = this._getOrReturnCtx(input);
			addIssueToContext(
				ctx,
				{
					code: ZodIssueCode.custom,
					message: `Expected Record ID to be part of table "${this._def.tb}", but found "${input.data.tb}"`
				}
			);

			return INVALID;
		}

		return {
			status: "valid",
			value: new RecordId(input.data.tb as Tb, input.data.id),
		}
	}
}

export function recordId<Tb extends string>(tb?: Tb) {
	return new ZodRecordId({ tb });
}

export class ZodDuration extends ZodType<Duration> {
	_parse(input: ParseInput): ParseReturnType<Duration> {
		if (!(input.data instanceof Duration)) {
			const ctx = this._getOrReturnCtx(input);
			addIssueToContext(
				ctx,
				{
					code: ZodIssueCode.custom,
					message: `Expected input to be instance of Duration, but found a value of type ${typeof input.data}`
				}
			);

			return INVALID;
		}

		return {
			status: "valid",
			value: input.data
		}
	}
}

export function duration() {
	return new ZodDuration({});
}

export class ZodDecimal extends ZodType<Decimal> {
	_parse(input: ParseInput): ParseReturnType<Decimal> {
		if (!(input.data instanceof Decimal)) {
			const ctx = this._getOrReturnCtx(input);
			addIssueToContext(
				ctx,
				{
					code: ZodIssueCode.custom,
					message: `Expected input to be instance of Decimal, but found a value of type ${typeof input.data}`
				}
			);

			return INVALID;
		}

		return {
			status: "valid",
			value: input.data
		}
	}
}

export function decimal() {
	return new ZodDecimal({});
}

export class ZodUuid extends ZodType<Uuid> {
	_parse(input: ParseInput): ParseReturnType<Uuid> {
		if (!(input.data instanceof Uuid)) {
			const ctx = this._getOrReturnCtx(input);
			addIssueToContext(
				ctx,
				{
					code: ZodIssueCode.custom,
					message: `Expected input to be instance of Uuid, but found a value of type ${typeof input.data}`
				}
			);

			return INVALID;
		}

		return {
			status: "valid",
			value: input.data
		}
	}
}

export function uuid() {
	return new ZodUuid({});
}

export const none = z.undefined;

export * from 'zod';
