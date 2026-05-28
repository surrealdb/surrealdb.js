import { RecordId, StringRecordId } from "@surrealdb/sqon";
import type { AnyRecordId, Expr } from "../types";

export function isAnyRecordId(value: unknown): value is AnyRecordId {
    return value instanceof RecordId || value instanceof StringRecordId;
}

export function isExpression(value: unknown): value is Expr {
    return !!value && typeof value === "object" && "toSQL" in value;
}
