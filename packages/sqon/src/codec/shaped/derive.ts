import { DateTime } from "../../value/datetime.ts";
import { Decimal } from "../../value/decimal.ts";
import { Duration } from "../../value/duration.ts";
import { RecordId } from "../../value/record-id.ts";
import { F16, F32, I8, I16, I32, SizedNumber, U8, U16, U32, U64 } from "../../value/sized.ts";
import { Uuid } from "../../value/uuid.ts";
import { MAX_COLUMNS, MAY_BE_ABSENT, MAY_BE_NULL, NO_SLOT } from "./constants.ts";
import { fixedWidth, isElement, Kind } from "./kinds.ts";
import { type Column, Shape } from "./shape.ts";

/**
 * Deriving the shape of rows which are about to be sent.
 *
 * The server shapes rows it has not seen yet, so it fits each row to the shape in hand and
 * widens or re-announces when one does not fit. A client already holds the whole array, so it
 * reads every row once to learn the union of what they hold, and then writes them all in one
 * shape. There is no joining and no re-announcement: one SHAPE, one BATCH.
 *
 * What a column cannot describe goes in a `dynamic` column, which holds one CBOR item, so a
 * shape is always possible for an array of objects — it just stops being worth sending when
 * most of it is dynamic.
 */

/** What was seen of one key across every row */
interface Observed {
    kinds: Set<Kind>;
    /** The element kind of every array seen, while they agree */
    element: Kind | undefined | null;
    /** The table every record id named, while they agree */
    table: string | undefined | null;
    absent: boolean;
    null: boolean;
    none: boolean;
}

/** The kind which holds `value`, or `undefined` for `null` and `NONE`, which are states */
function kindOf(value: unknown): Kind | undefined {
    if (value === null || value === undefined) return undefined;

    switch (typeof value) {
        case "boolean":
            return Kind.Bool;
        case "string":
            return Kind.String;
        case "bigint":
            return Kind.Int;
        case "number":
            // As the CBOR codec writes them: an integral number is an int
            return Number.isInteger(value) ? Kind.Int : Kind.Float;
    }

    if (value instanceof SizedNumber) return SIZED.get(value.constructor as never) ?? Kind.Dynamic;
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

/**
 * The element kind of an array: one kind, `"empty"` when the array says nothing about what it
 * holds, or `"mixed"` when its elements cannot share a column.
 */
function elementOf(value: unknown[]): Kind | "empty" | "mixed" {
    if (value.length === 0) return "empty";

    let element: Kind | undefined;
    for (const item of value) {
        // An element is never NULL or NONE; such an array goes in a dynamic column
        if (item === null || item === undefined) return "mixed";

        const kind = kindOf(item);
        if (kind === undefined || !isElement(kind)) return "mixed";
        if (element === undefined) element = kind;
        else if (element !== kind) return "mixed";
    }

    return element as Kind;
}

/** Whether every row is a plain object, which is the only thing an OBJECT root can hold */
function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
}

/**
 * The shape which holds every row of `rows`, or `undefined` when they are not rows a block can
 * carry: an empty array, or one whose entries are not all plain objects.
 */
export function deriveShape(rows: readonly unknown[]): Shape | undefined {
    if (rows.length === 0) return undefined;

    const seen = new Map<string, Observed>();

    for (const row of rows) {
        if (!isPlainObject(row)) return undefined;

        for (const [name, value] of Object.entries(row)) {
            observe(seen, name, value);
        }

        // A key some other row holds and this one does not is absent here
        if (seen.size > MAX_COLUMNS) return undefined;
        for (const [name, observed] of seen) {
            if (!Object.hasOwn(row, name)) observed.absent = true;
        }
    }

    if (seen.size === 0 || seen.size > MAX_COLUMNS) return undefined;

    return layout(seen);
}

function observe(seen: Map<string, Observed>, name: string, value: unknown): void {
    let observed = seen.get(name);
    if (!observed) {
        observed = {
            kinds: new Set(),
            element: undefined,
            table: undefined,
            absent: false,
            null: false,
            none: false,
        };
        seen.set(name, observed);
    }

    if (value === null) {
        observed.null = true;
        return;
    }
    if (value === undefined) {
        observed.none = true;
        return;
    }

    const kind = kindOf(value) as Kind;
    observed.kinds.add(kind);

    if (kind === Kind.Array) {
        const element = elementOf(value as unknown[]);

        // An empty array says nothing about the column's element kind, so it leaves it alone;
        // `null` records that the arrays disagreed, which sends the column to dynamic
        if (element === "mixed") observed.element = null;
        else if (element !== "empty" && observed.element !== null) {
            observed.element =
                observed.element === undefined || observed.element === element ? element : null;
        }
    }

    if (kind === Kind.Record) {
        const table = (value as RecordId).table.name;
        observed.table =
            observed.table === undefined ? table : observed.table === table ? table : null;
    }
}

/**
 * Turns what was observed into columns and a row layout: a slot in the fixed region for each
 * fixed kind, a var slot for each variable one, and presence bits for each column which was
 * ever missing, `NULL` or `NONE`.
 */
function layout(seen: Map<string, Observed>): Shape | undefined {
    // Siblings are listed in the byte order of their UTF-8, which a shape requires
    const names = [...seen.keys()].sort(byUtf8);

    const columns: Column[] = [];
    let fixedSize = 0;
    let varCount = 0;
    let presenceBits = 0;

    for (const name of names) {
        const observed = seen.get(name) as Observed;
        const kind = kindFor(observed);

        // A key whose value is ever NONE needs both bits, since NONE is the fourth state
        const flags =
            (observed.absent || observed.none ? MAY_BE_ABSENT : 0) |
            (observed.null || observed.none ? MAY_BE_NULL : 0);

        const width = presenceWidthOf(flags);
        const presence = width === 0 ? NO_SLOT : presenceBits;
        presenceBits += width;

        let slot: number;
        const fixed = fixedWidth(kind);
        if (fixed !== undefined) {
            slot = fixedSize;
            fixedSize += fixed;
        } else {
            slot = varCount;
            varCount += 1;
        }

        columns.push({
            name,
            kind,
            element: kind === Kind.Array ? ((observed.element ?? undefined) as Kind) : undefined,
            flags,
            presence,
            slot,
            table: kind === Kind.Record && typeof observed.table === "string" ? observed.table : "",
            children: 0,
            rest: NO_SLOT,
        });
    }

    try {
        return Shape.of({ presenceBits, fixedSize, varCount, columns });
    } catch {
        // A shape this SDK would refuse to read is one it must not write
        return undefined;
    }
}

/** The one kind a column holds, or `dynamic` when its rows did not agree on one */
function kindFor(observed: Observed): Kind {
    if (observed.kinds.size !== 1) return Kind.Dynamic;

    const [only] = observed.kinds;
    const kind = only as Kind;

    // An array whose element kind the rows did not agree on is one CBOR item instead
    if (kind === Kind.Array && (observed.element === null || observed.element === undefined)) {
        return Kind.Dynamic;
    }
    // A record column carries one table for every row, or each value carries its own; a client
    // writes the table per value rather than keeping a second form, so disagreement is fine
    return kind;
}

function presenceWidthOf(flags: number): number {
    const set = flags & (MAY_BE_ABSENT | MAY_BE_NULL);
    if (set === 0) return 0;
    return set === (MAY_BE_ABSENT | MAY_BE_NULL) ? 2 : 1;
}

/** Orders names by the bytes of their UTF-8, which is what a shape's order means */
function byUtf8(a: string, b: string): number {
    const x = UTF8.encode(a);
    const y = UTF8.encode(b);

    for (let i = 0; i < Math.min(x.length, y.length); i++) {
        const diff = (x[i] as number) - (y[i] as number);
        if (diff !== 0) return diff;
    }
    return x.length - y.length;
}

const UTF8 = new TextEncoder();
