import { refuse } from "./reader.ts";

/**
 * How a column holds its values. A fixed kind takes a slot of a known width in the row's fixed
 * region, a variable kind a slot in the row's var region, and `object` takes neither: its value
 * is built from the columns which follow it.
 */
export enum Kind {
    Bool = 0x01,
    Int = 0x02,
    Float = 0x03,
    Datetime = 0x04,
    Duration = 0x05,
    Uuid = 0x06,
    Bit = 0x07,
    I8 = 0x08,
    I16 = 0x09,
    I32 = 0x0a,
    U8 = 0x0b,
    U16 = 0x0c,
    U32 = 0x0d,
    U64 = 0x0e,
    F32 = 0x0f,
    String = 0x10,
    Bytes = 0x11,
    Decimal = 0x12,
    Record = 0x13,
    Dynamic = 0x14,
    Array = 0x16,
    F16 = 0x17,
    DatetimeNs = 0x18,
    DurationNs = 0x19,
    Object = 0x20,
}

const KINDS = new Set<number>(
    Object.values(Kind).filter((k): k is number => typeof k === "number"),
);

/** The kind a wire code names */
export function kindOf(code: number): Kind {
    if (!KINDS.has(code)) {
        refuse("an unknown column kind");
    }

    return code as Kind;
}

/**
 * The width of a fixed kind's slot in bytes, or `undefined` for a variable kind, for `object`,
 * and for `bit`, which takes one bit rather than a whole byte.
 */
export function fixedWidth(kind: Kind): number | undefined {
    switch (kind) {
        case Kind.Bool:
        case Kind.I8:
        case Kind.U8:
            return 1;
        case Kind.I16:
        case Kind.U16:
        case Kind.F16:
            return 2;
        case Kind.I32:
        case Kind.U32:
        case Kind.F32:
            return 4;
        case Kind.Int:
        case Kind.Float:
        case Kind.U64:
        case Kind.DatetimeNs:
        case Kind.DurationNs:
            return 8;
        case Kind.Datetime:
        case Kind.Duration:
            return 12;
        case Kind.Uuid:
            return 16;
        default:
            return undefined;
    }
}

/** Whether the kind is held in a var slot */
export function isVar(kind: Kind): boolean {
    return (
        kind === Kind.String ||
        kind === Kind.Bytes ||
        kind === Kind.Decimal ||
        kind === Kind.Record ||
        kind === Kind.Dynamic ||
        kind === Kind.Array
    );
}

/** Whether the kind may be the element kind of an array */
export function isElement(kind: Kind): boolean {
    switch (kind) {
        case Kind.String:
        case Kind.Bytes:
        case Kind.Decimal:
        case Kind.Int:
        case Kind.Float:
        case Kind.I8:
        case Kind.I16:
        case Kind.I32:
        case Kind.U8:
        case Kind.U16:
        case Kind.U32:
        case Kind.U64:
        case Kind.F16:
        case Kind.F32:
        case Kind.Bool:
        case Kind.Uuid:
        case Kind.Datetime:
        case Kind.Duration:
            return true;
        default:
            return false;
    }
}

/** Whether the kind keeps an overflow slot for the values its fixed slot cannot hold */
export function hasOverflow(kind: Kind): boolean {
    return kind === Kind.DatetimeNs || kind === Kind.DurationNs;
}
