import { DateTime } from "../../value/datetime.ts";
import { Decimal } from "../../value/decimal.ts";
import { Duration } from "../../value/duration.ts";
import { RecordId } from "../../value/record-id.ts";
import { F16, F32, I8, I16, I32, U8, U16, U32, U64 } from "../../value/sized.ts";
import { Uuid } from "../../value/uuid.ts";
import { fixedWidth, isVar, Kind } from "./kinds.ts";
import { ByteReader, refuse, Slices, text } from "./reader.ts";

/** Decodes the one CBOR item a dynamic slice holds */
export type DynamicDecoder = (bytes: Uint8Array) => unknown;

/** What reading a value needs beyond its own bytes */
export interface ReadContext {
    /** The CBOR decoder a dynamic slice goes through */
    dynamic: DynamicDecoder;
}

/** Integers at or below this are read as numbers; larger ones stay `bigint`, as CBOR reads them */
const POW_2_53 = 2n ** 53n;

/** An `int` as the CBOR path reads the same value: a number while it is exact, else a `bigint` */
export function int(value: bigint): number | bigint {
    return value <= POW_2_53 && value >= -POW_2_53 ? Number(value) : value;
}

/**
 * One value of a fixed kind, read where `r` stands.
 *
 * Both a column's slot in the fixed region and an element of an array of a fixed kind are a
 * value of that kind at an offset, so both read through here.
 */
export function fixedValue(kind: Kind, r: ByteReader): unknown {
    switch (kind) {
        case Kind.Bool:
            return bool(r.u8());
        case Kind.Int:
            return int(r.i64());
        case Kind.Float:
            return r.f64();
        case Kind.I8:
            return new I8(r.i8());
        case Kind.I16:
            return new I16(r.i16());
        case Kind.I32:
            return new I32(r.i32());
        case Kind.U8:
            return new U8(r.u8());
        case Kind.U16:
            return new U16(r.u16());
        case Kind.U32:
            return new U32(r.u32());
        case Kind.U64:
            return new U64(r.u64());
        case Kind.F16:
            return new F16(r.f16());
        case Kind.F32:
            return new F32(r.f32());
        case Kind.Uuid:
            return new Uuid(r.bytes(16).slice());
        case Kind.Datetime:
            return datetime(r.i64(), r.u32());
        case Kind.Duration:
            return duration(r.u64(), r.u32());
        default:
            return refuse("a value of a kind which has no fixed slot");
    }
}

/**
 * One value of a variable kind, held in `slice`. `table` is the one its column names for every
 * record it holds, and `element` the kind of every element when it is an array.
 */
export function varValue(
    kind: Kind,
    slice: Uint8Array,
    ctx: ReadContext,
    table = "",
    element?: Kind,
): unknown {
    switch (kind) {
        case Kind.String:
            return text(slice, "a string");
        case Kind.Bytes:
            return copy(slice);
        case Kind.Decimal:
            return new Decimal(text(slice, "a decimal"));
        case Kind.Dynamic:
            return dynamic(slice, ctx);
        case Kind.Record:
            return record(slice, table, ctx);
        case Kind.Array:
            return array(slice, element as Kind, ctx);
        default:
            return refuse("a value of a kind which has no var slot");
    }
}

/** The one CBOR item a dynamic slice holds */
export function dynamic(slice: Uint8Array, ctx: ReadContext): unknown {
    if (slice.length === 0) refuse("an empty dynamic slice");
    return ctx.dynamic(slice);
}

/**
 * The 8-byte nanosecond form of a datetime, which escapes to a 12-byte overflow slice at the
 * ends of its range.
 */
export function datetimeNs(r: ByteReader, overflow: () => Uint8Array): DateTime {
    const ns = r.i64();
    if (ns === MIN_I64 || ns === MAX_I64) {
        return datetime(...wide(overflow(), "a datetime"));
    }

    // Euclidean, so that a time before the epoch floors rather than truncating towards it
    const billion = 1_000_000_000n;
    let secs = ns / billion;
    let nanos = ns % billion;
    if (nanos < 0n) {
        secs -= 1n;
        nanos += billion;
    }
    return datetime(secs, Number(nanos));
}

/** The 8-byte nanosecond form of a duration, which escapes the same way */
export function durationNs(r: ByteReader, overflow: () => Uint8Array): Duration {
    const ns = r.u64();
    if (ns === MAX_U64) {
        const [secs, nanos] = wide(overflow(), "a duration");
        return duration(BigInt.asUintN(64, secs), nanos);
    }
    return duration(ns / 1_000_000_000n, Number(ns % 1_000_000_000n));
}

const MIN_I64 = -(2n ** 63n);
const MAX_I64 = 2n ** 63n - 1n;
const MAX_U64 = 2n ** 64n - 1n;

/** The seconds and nanoseconds of a 12-byte overflow slice */
function wide(slice: Uint8Array, what: string): [bigint, number] {
    if (slice.length !== 12) refuse(`${what} overflow that is not 12 bytes`);
    const view = new DataView(slice.buffer, slice.byteOffset, 12);
    return [view.getBigInt64(0, true), view.getUint32(8, true)];
}

function bool(byte: number): boolean {
    if (byte > 1) refuse("a bool that is neither 0 nor 1");
    return byte === 1;
}

/** A byte string decodes to an ArrayBuffer, as it does on the CBOR path */
function copy(slice: Uint8Array): ArrayBuffer {
    return slice.slice().buffer as ArrayBuffer;
}

/** A datetime of whole seconds and nanoseconds, which a leap second may carry past a billion */
function datetime(secs: bigint, nanos: number): DateTime {
    if (nanos >= 2_000_000_000) refuse("a datetime's nanoseconds out of range");
    return new DateTime([secs, BigInt(nanos)]);
}

/** A duration of whole seconds and nanoseconds */
function duration(secs: bigint, nanos: number): Duration {
    if (nanos >= 1_000_000_000) refuse("a duration's nanoseconds out of range");
    return new Duration([secs, BigInt(nanos)]);
}

/**
 * A record slice: a key kind byte, the table when the column does not name one for every value,
 * and then the id in the form that key kind gives it.
 */
function record(slice: Uint8Array, columnTable: string, ctx: ReadContext): RecordId {
    const r = new ByteReader(slice);
    const code = r.u8();

    // Key kind 3 is the whole record id as one CBOR item, table included
    if (code === 3) {
        const value = dynamic(r.rest, ctx);
        if (!(value instanceof RecordId)) {
            refuse("a record held as CBOR that is not a record id");
        }
        if (columnTable !== "" && value.table.name !== columnTable) {
            refuse("a record held as CBOR that names another table than its column");
        }
        return value;
    }

    const table = columnTable === "" ? r.text(r.u16(), "a table") : columnTable;

    switch (code) {
        case 0: {
            const id = int(r.i64());
            if (!r.done) refuse("bytes past a record's number id");
            return new RecordId(table, id);
        }
        case 1:
            return new RecordId(table, text(r.rest, "a record id"));
        case 2: {
            const id = r.bytes(16).slice();
            if (!r.done) refuse("bytes past a record's uuid id");
            return new RecordId(table, new Uuid(id));
        }
        default:
            return refuse("an unknown record key kind");
    }
}

/** An array slice: its count, then its elements, all of one kind */
function array(slice: Uint8Array, element: Kind, ctx: ReadContext): unknown[] {
    const r = new ByteReader(slice);
    const count = r.u32();

    if (isVar(element)) {
        const slices = new Slices(r, count);
        if (!r.done) refuse("bytes past an array's elements");

        const out: unknown[] = [];
        for (let i = 0; i < count; i++) {
            // An element is never NULL or NONE, and an array which holds one is written in a
            // dynamic column instead, so every element is a value of the kind the shape named
            out.push(varValue(element, slices.at(i), ctx));
        }
        return out;
    }

    const width = fixedWidth(element);
    if (width === undefined) refuse("an invalid array element kind");
    if (r.rest.length !== count * width) refuse("an array of the wrong length");

    const out: unknown[] = [];
    for (let i = 0; i < count; i++) out.push(fixedValue(element, r));
    return out;
}
