import { DateTime } from "../../value/datetime.ts";
import { Decimal } from "../../value/decimal.ts";
import { Duration } from "../../value/duration.ts";
import { RecordId } from "../../value/record-id.ts";
import { F16, F32, I8, I16, I32, SizedNumber, U8, U16, U32, U64 } from "../../value/sized.ts";
import { Uuid } from "../../value/uuid.ts";
import { isElement, Kind } from "./kinds.ts";

/**
 * Working out which kind holds a JavaScript value.
 *
 * This is the one place a value is classified, so that the shape a batch is measured against
 * and the bytes it is written as can never disagree about what something is.
 */

/** Stands for "the rows did not agree", which is not a kind a column can be given */
export const MIXED = -1;

/** The bounds of a SurrealDB `int`, which is an i64 */
const I64_MIN = -(2n ** 63n);
const I64_MAX = 2n ** 63n - 1n;

const SIZED = new Map<unknown, Kind>([
    [I8, Kind.I8],
    [I16, Kind.I16],
    [I32, Kind.I32],
    [U8, Kind.U8],
    [U16, Kind.U16],
    [U32, Kind.U32],
    [U64, Kind.U64],
    [F16, Kind.F16],
    [F32, Kind.F32],
]);

/** The kind which holds `value`, which is never `null` or `undefined` — those are states */
export function kindOf(value: unknown): Kind {
    switch (typeof value) {
        case "boolean":
            return Kind.Bool;
        case "string":
            return Kind.String;
        case "bigint":
            // Past the range of an `int` the CBOR codec refuses the value rather than sending
            // it. A dynamic column holds one CBOR item, so it is refused there in the same way
            // instead of being wrapped into range by the fixed slot.
            return value >= I64_MIN && value <= I64_MAX ? Kind.Int : Kind.Dynamic;
        case "number":
            // As the CBOR codec writes them. `-0` is written as a float, and an int column
            // would lose the sign it is the whole of; an integral number too large for an i64
            // is a float there too, and an int column would wrap it.
            if (!Number.isInteger(value) || Object.is(value, -0)) return Kind.Float;
            return value >= -(2 ** 63) && value < 2 ** 63 ? Kind.Int : Kind.Float;
    }

    if (value instanceof SizedNumber) {
        return SIZED.get(value.constructor as never) ?? Kind.Dynamic;
    }
    if (value instanceof DateTime) return Kind.Datetime;
    if (value instanceof Duration) return Kind.Duration;
    if (value instanceof Uuid) return Kind.Uuid;
    if (value instanceof Decimal) return Kind.Decimal;
    if (value instanceof RecordId) return Kind.Record;
    if (value instanceof Uint8Array || value instanceof ArrayBuffer) return Kind.Bytes;
    if (Array.isArray(value)) return Kind.Array;

    // Everything else — a nested object, a set, a geometry, a range — is one CBOR item. The
    // server derives nested object columns too; a client leaves that to a dynamic column, which
    // costs the nesting's compression but never a wrong shape.
    return Kind.Dynamic;
}

/**
 * The element kind of an array: one kind, `"empty"` when the array says nothing about what it
 * holds, or `"mixed"` when its elements cannot share a column.
 */
export function elementOf(value: unknown[]): Kind | "empty" | "mixed" {
    if (value.length === 0) return "empty";

    let element: Kind | undefined;
    for (const item of value) {
        // An element is never NULL or NONE; such an array goes in a dynamic column
        if (item === null || item === undefined) return "mixed";

        const kind = kindOf(item);
        if (!isElement(kind)) return "mixed";
        if (element === undefined) element = kind;
        else if (element !== kind) return "mixed";
    }

    return element as Kind;
}

/** Whether every row is a plain object, which is the only thing an OBJECT root can hold */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
}
