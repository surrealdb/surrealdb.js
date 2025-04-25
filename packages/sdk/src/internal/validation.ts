import { BoundExcluded, BoundIncluded, type Bound } from "../utils/range";
import { Uuid, type RecordIdValue } from "../value";

export function isValidIdPart(v: unknown): v is RecordIdValue {
	if (v instanceof Uuid) return true;

	switch (typeof v) {
		case "string":
		case "number":
		case "bigint":
			return true;
		case "object":
			return Array.isArray(v) || v !== null;
		default:
			return false;
	}
}

export function isValidIdBound(
	bound: Bound<unknown>,
): bound is Bound<RecordIdValue> {
	return bound instanceof BoundIncluded || bound instanceof BoundExcluded
		? isValidIdPart(bound.value)
		: true;
}
