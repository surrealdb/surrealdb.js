import { type Bound, BoundExcluded, BoundIncluded } from "../utils/range";
import { type RecordIdValue, Table, Uuid } from "../value";

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

export function isValidIdBound(bound: unknown): bound is Bound<RecordIdValue> {
	return bound instanceof BoundIncluded || bound instanceof BoundExcluded
		? isValidIdPart(bound.value)
		: true;
}

export function isValidTable(tb: unknown): tb is string | Table {
	return tb instanceof Table || typeof tb === "string";
}
