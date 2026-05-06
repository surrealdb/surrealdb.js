import type { AnyRecordId, Expr } from "../types";
import { type Bound, BoundExcluded, BoundIncluded } from "../utils/range";
import { isBoundExcluded, isBoundIncluded, isRecordId, isStringRecordId, isTable, isUuid } from "../utils/symbols";
import { RecordId, type RecordIdValue, StringRecordId, Table, Uuid } from "../value";

export function isValidIdPart(v: unknown): v is RecordIdValue {
    if (isUuid(v)) return true;

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
    return isBoundIncluded(bound) || isBoundExcluded(bound)
        ? isValidIdPart((bound as unknown as BoundIncluded<RecordIdValue> | BoundExcluded<RecordIdValue>).value)
        : true;
}

export function isValidTable(tb: unknown): tb is string | Table {
    return isTable(tb) || typeof tb === "string";
}

export function isAnyRecordId(value: unknown): value is AnyRecordId {
    return isRecordId(value) || isStringRecordId(value);
}

export function isExpression(value: unknown): value is Expr {
    return !!value && typeof value === "object" && "toSQL" in value;
}
