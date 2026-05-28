import { type Bound, BoundExcluded, BoundIncluded } from "../utils/range.ts";
import { type RecordIdValue, Table, Uuid } from "../value/index.ts";

export function isValidIdPart(v: unknown): v is RecordIdValue {
    if (v instanceof Uuid) return true;

    switch (typeof v) {
        case "string":
        case "number":
        case "bigint":
            return true;
        case "object":
            if (v === null) return false;
            if (Array.isArray(v)) return true;
            return isPlainObject(v);
        default:
            return false;
    }
}

export function isPlainObject(v: unknown): v is Record<string, unknown> {
    if (v === null || typeof v !== "object") return false;
    const proto = Object.getPrototypeOf(v);
    return proto === null || proto === Object.prototype;
}

export function isValidIdBound(bound: unknown): bound is Bound<RecordIdValue> {
    return bound instanceof BoundIncluded || bound instanceof BoundExcluded
        ? isValidIdPart(bound.value)
        : true;
}

export function isValidTable(tb: unknown): tb is string | Table {
    return tb instanceof Table || typeof tb === "string";
}
