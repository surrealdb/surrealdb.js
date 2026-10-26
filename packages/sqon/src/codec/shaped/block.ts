import { ShapedFrameError } from "../../errors.ts";
import { DateTime } from "../../value/datetime.ts";
import { Decimal } from "../../value/decimal.ts";
import { Duration } from "../../value/duration.ts";
import { RecordId } from "../../value/record-id.ts";
import { F16, F32, I8, I16, I32, U8, U16, U32, U64 } from "../../value/sized.ts";
import { Uuid } from "../../value/uuid.ts";
import {
    MAX_EMPTY_ROWS,
    MAX_SHAPES,
    MAY_BE_ABSENT,
    MAY_BE_NULL,
    MESSAGE_BATCH,
    MESSAGE_SHAPE,
    NO_SLOT,
    presenceWidth,
    ROOT_VALUE,
    STATE_ABSENT,
    STATE_NONE,
    STATE_NULL,
    STATE_VALUE,
    VERSION,
} from "./constants.ts";
import { fixedWidth, isVar, Kind } from "./kinds.ts";
import { ByteReader, text } from "./reader.ts";
import { type Column, Shape } from "./shape.ts";

/** Decodes one CBOR item, which a dynamic slice holds exactly one of */
export type DynamicDecoder = (bytes: Uint8Array) => unknown;

/** Integers at or below this are read as numbers; larger ones stay `bigint`, as CBOR reads them */
const POW_2_53 = 2n ** 53n;

/** An `int` as the CBOR path reads the same value: a number while it is exact, else a `bigint` */
function int(value: bigint): number | bigint {
    return value <= POW_2_53 && value >= -POW_2_53 ? Number(value) : value;
}

/**
 * A block of rows, still in its bytes.
 *
 * Tag 57 decodes to this rather than to the rows themselves, because the shape ids a block
 * names live in a scope which is wider than the one CBOR item: the frames of one `query_stream`
 * share a scope, and so do the notifications of one live query. The envelope is decoded first,
 * which says which scope a block belongs to, and the block is read against it afterwards.
 */
export class ShapedBlock {
    /** The block's contents: its version byte and messages, past the CBOR byte string head */
    readonly contents: Uint8Array;

    constructor(contents: Uint8Array) {
        this.contents = contents;
    }
}

/**
 * The shapes announced in one scope, and the reader which turns that scope's blocks into rows.
 *
 * A SHAPE message announces a shape under an id; the batches after it name the shape by that id,
 * in the same block or in a later one of the same scope. Announcing an id again replaces it for
 * the batches which follow.
 */
export class BlockReader {
    #shapes = new Map<number, Shape>();

    /** Forgets every shape, ending the scope */
    reset(): void {
        this.#shapes.clear();
    }

    /** The rows of `block`, read against the shapes this scope has announced so far */
    read(block: ShapedBlock, dynamic: DynamicDecoder): unknown[] {
        const r = new ByteReader(block.contents);

        if (r.u8() !== VERSION) {
            throw new ShapedFrameError("an unknown block version");
        }

        const rows: unknown[] = [];

        while (!r.done) {
            const kind = r.u8();
            const payload = r.take(r.u32());

            switch (kind) {
                case MESSAGE_SHAPE: {
                    const p = new ByteReader(payload);
                    const id = p.u32();
                    const shape = Shape.decode(p.rest);

                    if (!this.#shapes.has(id) && this.#shapes.size >= MAX_SHAPES) {
                        throw new ShapedFrameError("too many shapes in one scope");
                    }

                    this.#shapes.set(id, shape);
                    break;
                }

                case MESSAGE_BATCH: {
                    const p = new ByteReader(payload);
                    const id = p.u32();
                    const count = p.u32();
                    const shape = this.#shapes.get(id);

                    if (!shape) {
                        throw new ShapedFrameError("a batch of an unannounced shape");
                    }

                    // A row of a zero-width shape takes no bytes, so the payload cannot bound
                    // the count; such a batch is bounded by its own limit instead.
                    if (shape.headerLength === 0 && count > MAX_EMPTY_ROWS) {
                        throw new ShapedFrameError("a batch of too many empty rows");
                    }

                    let bytes = p.rest;
                    for (let i = 0; i < count; i++) {
                        const [value, used] = decodeRow(shape, bytes, dynamic);
                        rows.push(value);
                        bytes = bytes.subarray(used);
                    }

                    if (bytes.length !== 0) {
                        throw new ShapedFrameError("bytes past a batch's rows");
                    }
                    break;
                }

                // A message this version does not know is skipped
                default:
                    break;
            }
        }

        return rows;
    }
}

/** One row of `shape` at the start of `bytes`: its value, and the bytes it took */
export function decodeRow(
    shape: Shape,
    bytes: Uint8Array,
    dynamic: DynamicDecoder,
): [unknown, number] {
    const header = shape.headerLength;
    if (bytes.length < header) {
        throw new ShapedFrameError("a truncated row");
    }

    const presenceLength = shape.presenceLength;
    const presence = bytes.subarray(0, presenceLength);

    // Every presence bit past the last state is zero
    for (let at = 0; at < presence.length; at++) {
        const low = 8 * at;
        if (low + 8 > shape.presenceBits) {
            const keep = Math.max(shape.presenceBits - low, 0);
            if ((presence[at] as number) >>> keep !== 0) {
                throw new ShapedFrameError("presence padding bits set");
            }
        }
    }

    const fixed = bytes.subarray(presenceLength, shape.endsAt);
    const endsBytes = bytes.subarray(shape.endsAt, header);
    const ends = new Uint32Array(shape.varCount);
    const endsView = new DataView(endsBytes.buffer, endsBytes.byteOffset, endsBytes.byteLength);

    let last = 0;
    for (let i = 0; i < shape.varCount; i++) {
        const end = endsView.getUint32(4 * i, true);
        if (end < last) {
            throw new ShapedFrameError("var ends out of order");
        }
        last = end;
        ends[i] = end;
    }

    const total = header + last;
    if (bytes.length < total) {
        throw new ShapedFrameError("a truncated row");
    }

    const row = new Row(shape, presence, fixed, ends, bytes.subarray(header, total), dynamic);
    const value =
        shape.root === ROOT_VALUE ? row.dynamic(row.slice(shape.rootRest)) : row.node(undefined);

    return [value, total];
}

/** One row's regions, and the reads which turn them into values */
class Row {
    #shape: Shape;
    #presence: Uint8Array;
    #fixed: Uint8Array;
    #fixedView: DataView;
    #ends: Uint32Array;
    #var: Uint8Array;
    #dynamic: DynamicDecoder;

    constructor(
        shape: Shape,
        presence: Uint8Array,
        fixed: Uint8Array,
        ends: Uint32Array,
        variable: Uint8Array,
        dynamic: DynamicDecoder,
    ) {
        this.#shape = shape;
        this.#presence = presence;
        this.#fixed = fixed;
        this.#fixedView = new DataView(fixed.buffer, fixed.byteOffset, fixed.byteLength);
        this.#ends = ends;
        this.#var = variable;
        this.#dynamic = dynamic;
    }

    #bit(at: number): boolean {
        const byte = this.#presence[at >>> 3];
        if (byte === undefined) {
            throw new ShapedFrameError("a presence bit out of range");
        }
        return (byte & (1 << (at % 8))) !== 0;
    }

    /** `column`'s presence state, read from the bits its flags give it */
    #state(column: Column): number {
        const p = column.presence;
        switch (presenceWidth(column.flags)) {
            case 0:
                return STATE_VALUE;
            case 1:
                if (this.#bit(p)) return STATE_VALUE;
                return (column.flags & MAY_BE_ABSENT) !== 0 ? STATE_ABSENT : STATE_NULL;
            default:
                return (this.#bit(p) ? 1 : 0) | ((this.#bit(p + 1) ? 1 : 0) << 1);
        }
    }

    #fixedBit(at: number): boolean {
        const byte = this.#fixed[at >>> 3];
        if (byte === undefined) {
            throw new ShapedFrameError("a fixed bit out of range");
        }
        return (byte & (1 << (at % 8))) !== 0;
    }

    /** The bytes of var slot `slot` */
    slice(slot: number): Uint8Array {
        if (slot >= this.#ends.length) {
            throw new ShapedFrameError("a var slot out of range");
        }
        const end = this.#ends[slot] as number;
        const start = slot === 0 ? 0 : (this.#ends[slot - 1] as number);
        if (end > this.#var.length) {
            throw new ShapedFrameError("a var slice out of range");
        }
        return this.#var.subarray(start, end);
    }

    /** One CBOR item, which a dynamic slice holds exactly one of */
    dynamic(slice: Uint8Array): unknown {
        if (slice.length === 0) {
            throw new ShapedFrameError("an empty dynamic slice");
        }
        return this.#dynamic(slice);
    }

    #at(offset: number, width: number): number {
        if (offset + width > this.#fixed.length) {
            throw new ShapedFrameError("a fixed slot out of range");
        }
        return offset;
    }

    /** The object a node builds: its remainder's entries, then its columns */
    node(node: number | undefined): Record<string, unknown> {
        const object: Record<string, unknown> = {};
        const rest = this.#shape.rest(node);

        if (rest !== NO_SLOT) {
            const slice = this.slice(rest);
            if (slice.length !== 0) {
                const entries = this.dynamic(slice);
                const proto =
                    typeof entries === "object" && entries !== null
                        ? Object.getPrototypeOf(entries)
                        : false;
                if (proto !== Object.prototype && proto !== null) {
                    throw new ShapedFrameError("a remainder that is not an object");
                }
                Object.assign(object, entries);
            }
        }

        for (const at of this.#shape.children(node)) {
            const column = this.#shape.columns[at] as Column;
            const state = this.#state(column);

            let value: unknown;
            if (state === STATE_ABSENT && (column.flags & MAY_BE_ABSENT) !== 0) {
                continue;
            } else if (state === STATE_NULL && (column.flags & MAY_BE_NULL) !== 0) {
                value = null;
            } else if (state === STATE_NONE && (column.flags & MAY_BE_ABSENT) !== 0) {
                value = undefined;
            } else if (state === STATE_VALUE) {
                value = this.leaf(at);
            } else {
                throw new ShapedFrameError("a presence state the column does not allow");
            }

            if (Object.hasOwn(object, column.name)) {
                throw new ShapedFrameError("a remainder key that has a column");
            }
            object[column.name] = value;
        }

        return object;
    }

    /** The value of column `at`, whose presence says it holds one */
    leaf(at: number): unknown {
        const column = this.#shape.columns[at] as Column;
        const slot = column.slot;
        const view = this.#fixedView;

        switch (column.kind) {
            case Kind.Bool: {
                const byte = this.#fixed[this.#at(slot, 1)] as number;
                if (byte > 1) throw new ShapedFrameError("a bool that is neither 0 nor 1");
                return byte === 1;
            }
            case Kind.Int:
                return int(view.getBigInt64(this.#at(slot, 8), true));
            case Kind.Float:
                return view.getFloat64(this.#at(slot, 8), true);
            case Kind.Datetime:
                return datetime(
                    view.getBigInt64(this.#at(slot, 12), true),
                    view.getUint32(slot + 8, true),
                );
            case Kind.Duration:
                return duration(
                    view.getBigUint64(this.#at(slot, 12), true),
                    view.getUint32(slot + 8, true),
                );
            case Kind.Uuid:
                return new Uuid(this.#fixed.slice(this.#at(slot, 16), slot + 16));
            case Kind.Bit:
                return this.#fixedBit(slot);
            case Kind.I8:
                return new I8(view.getInt8(this.#at(slot, 1)));
            case Kind.I16:
                return new I16(view.getInt16(this.#at(slot, 2), true));
            case Kind.I32:
                return new I32(view.getInt32(this.#at(slot, 4), true));
            case Kind.U8:
                return new U8(view.getUint8(this.#at(slot, 1)));
            case Kind.U16:
                return new U16(view.getUint16(this.#at(slot, 2), true));
            case Kind.U32:
                return new U32(view.getUint32(this.#at(slot, 4), true));
            case Kind.U64:
                return new U64(view.getBigUint64(this.#at(slot, 8), true));
            case Kind.F16:
                return new F16(f16(view.getUint16(this.#at(slot, 2), true)));
            case Kind.F32:
                return new F32(view.getFloat32(this.#at(slot, 4), true));
            case Kind.String:
                return text(this.slice(slot), "a string");
            case Kind.Bytes:
                // A byte string decodes to an ArrayBuffer on the CBOR path; match it here
                return bytesOf(this.slice(slot));
            case Kind.Decimal:
                return new Decimal(text(this.slice(slot), "a decimal"));
            case Kind.Record:
                return this.#record(this.slice(slot), column.table);
            case Kind.Dynamic:
                return this.dynamic(this.slice(slot));
            case Kind.Object:
                return this.node(at);
            case Kind.Array:
                return this.#array(this.slice(slot), column.element as Kind);
            case Kind.DatetimeNs: {
                const ns = view.getBigInt64(this.#at(slot, 8), true);
                if (ns === -(2n ** 63n) || ns === 2n ** 63n - 1n) {
                    const b = this.slice(column.rest);
                    if (b.length !== 12) {
                        throw new ShapedFrameError("a datetime overflow that is not 12 bytes");
                    }
                    const v = new DataView(b.buffer, b.byteOffset, 12);
                    return datetime(v.getBigInt64(0, true), v.getUint32(8, true));
                }
                const billion = 1_000_000_000n;
                // Euclidean division, so that a time before the epoch floors rather than truncates
                let secs = ns / billion;
                let nanos = ns % billion;
                if (nanos < 0n) {
                    secs -= 1n;
                    nanos += billion;
                }
                return datetime(secs, Number(nanos));
            }
            case Kind.DurationNs: {
                const ns = view.getBigUint64(this.#at(slot, 8), true);
                if (ns === 2n ** 64n - 1n) {
                    const b = this.slice(column.rest);
                    if (b.length !== 12) {
                        throw new ShapedFrameError("a duration overflow that is not 12 bytes");
                    }
                    const v = new DataView(b.buffer, b.byteOffset, 12);
                    return duration(v.getBigUint64(0, true), v.getUint32(8, true));
                }
                return duration(ns / 1_000_000_000n, Number(ns % 1_000_000_000n));
            }
        }
    }

    /** A record slice: its key kind, the table when the column does not carry it, and the id */
    #record(slice: Uint8Array, columnTable: string): unknown {
        const r = new ByteReader(slice);
        const code = r.u8();

        if (code === 3) {
            // The whole record id as one CBOR item, table included
            const value = this.dynamic(r.rest);
            if (!(value instanceof RecordId)) {
                throw new ShapedFrameError("a record held as CBOR that is not a record id");
            }
            if (columnTable !== "" && value.table.name !== columnTable) {
                throw new ShapedFrameError(
                    "a record held as CBOR that names another table than its column",
                );
            }
            return value;
        }

        const table = columnTable === "" ? text(r.take(r.u16()), "a table") : columnTable;

        switch (code) {
            case 0: {
                const id = r.take(8);
                if (!r.done) throw new ShapedFrameError("bytes past a record's number id");
                const view = new DataView(id.buffer, id.byteOffset, 8);
                return new RecordId(table, int(view.getBigInt64(0, true)));
            }
            case 1:
                return new RecordId(table, text(r.rest, "a record id"));
            case 2: {
                const id = r.take(16).slice();
                if (!r.done) throw new ShapedFrameError("bytes past a record's uuid id");
                return new RecordId(table, new Uuid(id));
            }
            default:
                throw new ShapedFrameError("an unknown record key kind");
        }
    }

    /** An array slice: its count, then its elements, all of one kind */
    #array(slice: Uint8Array, kind: Kind): unknown[] {
        const r = new ByteReader(slice);
        const count = r.u32();

        if (isVar(kind)) {
            const ends = r.take(count * 4);
            const endsView = new DataView(ends.buffer, ends.byteOffset, ends.byteLength);
            const bytes = r.rest;

            const out: unknown[] = [];
            let start = 0;
            for (let at = 0; at < count; at++) {
                const end = endsView.getUint32(4 * at, true);
                if (end < start || end > bytes.length) {
                    throw new ShapedFrameError("an array element out of range");
                }
                const element = bytes.subarray(start, end);
                out.push(
                    kind === Kind.String
                        ? text(element, "a string")
                        : kind === Kind.Bytes
                          ? bytesOf(element)
                          : new Decimal(text(element, "a decimal")),
                );
                start = end;
            }

            if (start !== bytes.length) {
                throw new ShapedFrameError("bytes past an array's elements");
            }
            return out;
        }

        const width = fixedWidth(kind);
        if (width === undefined) {
            throw new ShapedFrameError("an invalid array element kind");
        }

        const bytes = r.rest;
        if (bytes.length !== count * width) {
            throw new ShapedFrameError("an array of the wrong length");
        }

        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const out: unknown[] = [];

        for (let at = 0; at < count; at++) {
            const o = at * width;
            switch (kind) {
                case Kind.Bool: {
                    const byte = view.getUint8(o);
                    if (byte > 1) throw new ShapedFrameError("a bool that is neither 0 nor 1");
                    out.push(byte === 1);
                    break;
                }
                case Kind.Int:
                    out.push(int(view.getBigInt64(o, true)));
                    break;
                case Kind.Float:
                    out.push(view.getFloat64(o, true));
                    break;
                case Kind.I8:
                    out.push(new I8(view.getInt8(o)));
                    break;
                case Kind.I16:
                    out.push(new I16(view.getInt16(o, true)));
                    break;
                case Kind.I32:
                    out.push(new I32(view.getInt32(o, true)));
                    break;
                case Kind.U8:
                    out.push(new U8(view.getUint8(o)));
                    break;
                case Kind.U16:
                    out.push(new U16(view.getUint16(o, true)));
                    break;
                case Kind.U32:
                    out.push(new U32(view.getUint32(o, true)));
                    break;
                case Kind.U64:
                    out.push(new U64(view.getBigUint64(o, true)));
                    break;
                case Kind.F16:
                    out.push(new F16(f16(view.getUint16(o, true))));
                    break;
                case Kind.F32:
                    out.push(new F32(view.getFloat32(o, true)));
                    break;
                case Kind.Uuid:
                    out.push(new Uuid(bytes.slice(o, o + 16)));
                    break;
                case Kind.Datetime:
                    out.push(datetime(view.getBigInt64(o, true), view.getUint32(o + 8, true)));
                    break;
                case Kind.Duration:
                    out.push(duration(view.getBigUint64(o, true), view.getUint32(o + 8, true)));
                    break;
                default:
                    throw new ShapedFrameError("an invalid array element kind");
            }
        }

        return out;
    }
}

/** A copy of `slice` as an ArrayBuffer, which is what a CBOR byte string decodes to */
function bytesOf(slice: Uint8Array): ArrayBuffer {
    return slice.slice().buffer as ArrayBuffer;
}

/** A datetime of whole seconds and nanoseconds, which a leap second may carry past a billion */
function datetime(secs: bigint, nanos: number): DateTime {
    if (nanos >= 2_000_000_000) {
        throw new ShapedFrameError("a datetime's nanoseconds out of range");
    }
    return new DateTime([secs, BigInt(nanos)]);
}

/** A duration of whole seconds and nanoseconds */
function duration(secs: bigint, nanos: number): Duration {
    if (nanos >= 1_000_000_000) {
        throw new ShapedFrameError("a duration's nanoseconds out of range");
    }
    return new Duration([secs, BigInt(nanos)]);
}

/** The number an IEEE 754 binary16 bit pattern holds */
function f16(bits: number): number {
    const sign = bits & 0x8000 ? -1 : 1;
    const exponent = (bits >> 10) & 0x1f;
    const fraction = bits & 0x3ff;

    if (exponent === 0) return sign * 2 ** -24 * fraction;
    if (exponent === 0x1f) return fraction ? Number.NaN : sign * Number.POSITIVE_INFINITY;
    return sign * 2 ** (exponent - 25) * (1024 + fraction);
}
