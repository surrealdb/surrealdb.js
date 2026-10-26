import type { DateTime } from "../../value/datetime.ts";
import type { Decimal } from "../../value/decimal.ts";
import type { Duration } from "../../value/duration.ts";
import type { RecordId } from "../../value/record-id.ts";
import type { SizedNumber } from "../../value/sized.ts";
import { Uuid } from "../../value/uuid.ts";
import {
    MAY_BE_ABSENT,
    MESSAGE_BATCH,
    MESSAGE_SHAPE,
    presenceBytes,
    presenceWidth,
    STATE_ABSENT,
    STATE_NONE,
    STATE_NULL,
    STATE_VALUE,
    VERSION,
} from "./constants.ts";
import { fixedWidth, isVar, Kind } from "./kinds.ts";
import { ByteWriter, f16Bits as f16Of, refuse } from "./reader.ts";
import type { Column, Shape } from "./shape.ts";

/** Encodes one value as a CBOR item, for the slices which hold one */
export type DynamicEncoder = (value: unknown) => Uint8Array;

/**
 * Writing rows into a block.
 *
 * Only a request ever carries a block this SDK wrote: the server reads one wherever a CBOR
 * request holds a value, and answers are read, never written. A row is written in the shape
 * {@link deriveShape} found for the whole array, so every row fits by construction and a write
 * which does not fit is a bug rather than something to recover from.
 */

/** One block: a SHAPE message announcing `shape` under id 1, then a BATCH of every row */
export function writeBlock(
    shape: Shape,
    rows: readonly unknown[],
    dynamic: DynamicEncoder,
): Uint8Array {
    const out = new ByteWriter().u8(VERSION);

    const payload = shape.encode();
    out.u8(MESSAGE_SHAPE)
        .u32(payload.length + 4)
        .u32(1)
        .raw(payload);

    // The batch's length is only known once its rows are written, so it is patched afterwards
    out.u8(MESSAGE_BATCH);
    const lengthAt = out.length;
    out.u32(0).u32(1).u32(rows.length);

    const body = out.length;
    for (const row of rows) writeRow(out, shape, row, dynamic);
    out.patchU32(lengthAt, out.length - body + 8);

    return out.bytes;
}

/**
 * One row:
 *
 * ```
 * row = presence[ceil(presence_bits / 8)]  fixed[fixed_size]  ends[var_count]:u32  var[L]
 * ```
 *
 * The presence and fixed regions are a fixed size, so they are built in place and copied in;
 * the var slices are gathered as they are produced, which is what gives the ends table.
 */
export function writeRow(
    out: ByteWriter,
    shape: Shape,
    row: unknown,
    dynamic: DynamicEncoder,
): void {
    const object = row as Record<string, unknown>;

    const presence = new Uint8Array(presenceBytes(shape.presenceBits));
    const fixed = new Uint8Array(shape.fixedSize);
    const fixedView = new DataView(fixed.buffer);
    const slices: Uint8Array[] = new Array(shape.varCount).fill(EMPTY);

    writeNode(shape, undefined, object, presence, fixed, fixedView, slices, dynamic);

    out.raw(presence).raw(fixed);

    let end = 0;
    for (const slice of slices) {
        end += slice.length;
        out.u32(end);
    }
    for (const slice of slices) out.raw(slice);
}

const EMPTY = new Uint8Array(0);

/**
 * Writes the columns of one node — the root, or an `object` column's subtree — from the object
 * which holds them.
 *
 * An object column has no slot of its own: its value is its children, which are the columns
 * which follow it. A node which is not present leaves every slot beneath it zero and every var
 * slice beneath it empty, which is the same bytes a row without those keys writes, so nothing
 * has to be written for it at all.
 */
function writeNode(
    shape: Shape,
    node: number | undefined,
    object: Record<string, unknown>,
    presence: Uint8Array,
    fixed: Uint8Array,
    fixedView: DataView,
    slices: Uint8Array[],
    dynamic: DynamicEncoder,
): void {
    for (const at of shape.children(node)) {
        const column = shape.columns[at] as Column;
        const held = Object.hasOwn(object, column.name);
        const value = object[column.name];

        const state =
            !held || value === undefined
                ? held
                    ? STATE_NONE
                    : STATE_ABSENT
                : value === null
                  ? STATE_NULL
                  : STATE_VALUE;

        setState(presence, column, state);

        // A column which is absent, NULL or NONE leaves its slot zero and its slice empty,
        // which is what makes a hidden value and a missing key the same bytes
        if (state !== STATE_VALUE) continue;

        if (column.kind === Kind.Object) {
            writeNode(
                shape,
                at,
                value as Record<string, unknown>,
                presence,
                fixed,
                fixedView,
                slices,
                dynamic,
            );
        } else if (isVar(column.kind)) {
            slices[column.slot] = varBytes(column, value, dynamic);
        } else {
            writeFixed(fixedView, fixed, column.slot, column.kind, value);
        }
    }
}

/** Puts `column` into `state`, in the bits its flags give it */
function setState(presence: Uint8Array, column: Column, state: number): void {
    const width = presenceWidth(column.flags);
    if (width === 0) {
        if (state !== STATE_VALUE) refuse("a required column which holds no value");
        return;
    }

    if (width === 1) {
        // One bit: set for a value, clear for whichever of the two the flag allows
        const clear = (column.flags & MAY_BE_ABSENT) !== 0 ? STATE_ABSENT : (STATE_NULL as number);
        if (state !== STATE_VALUE && state !== clear) {
            refuse("a column in a state its flags do not allow");
        }
        if (state === STATE_VALUE) setBit(presence, column.presence);
        return;
    }

    if (state & 0b01) setBit(presence, column.presence);
    if (state & 0b10) setBit(presence, column.presence + 1);
}

function setBit(bytes: Uint8Array, at: number): void {
    bytes[at >>> 3] = (bytes[at >>> 3] as number) | (1 << (at % 8));
}

/** Writes a value of a fixed kind into its slot */
export function writeFixed(
    view: DataView,
    bytes: Uint8Array,
    at: number,
    kind: Kind,
    value: unknown,
): void {
    switch (kind) {
        case Kind.Bool:
            view.setUint8(at, value === true ? 1 : 0);
            return;
        case Kind.Int:
            view.setBigInt64(at, BigInt(value as number | bigint), true);
            return;
        case Kind.Float:
            view.setFloat64(at, value as number, true);
            return;
        case Kind.I8:
            view.setInt8(at, sized(value));
            return;
        case Kind.I16:
            view.setInt16(at, sized(value), true);
            return;
        case Kind.I32:
            view.setInt32(at, sized(value), true);
            return;
        case Kind.U8:
            view.setUint8(at, sized(value));
            return;
        case Kind.U16:
            view.setUint16(at, sized(value), true);
            return;
        case Kind.U32:
            view.setUint32(at, sized(value), true);
            return;
        case Kind.U64:
            view.setBigUint64(at, BigInt((value as SizedNumber).value), true);
            return;
        case Kind.F16:
            view.setUint16(at, f16Of(sized(value)), true);
            return;
        case Kind.F32:
            view.setFloat32(at, sized(value), true);
            return;
        case Kind.Uuid:
            bytes.set(new Uuid(value as Uuid).toUint8Array(), at);
            return;
        case Kind.Datetime: {
            const [secs, nanos] = (value as DateTime).toCompact();
            view.setBigInt64(at, secs, true);
            view.setUint32(at + 8, Number(nanos), true);
            return;
        }
        case Kind.Duration: {
            const [secs = 0n, nanos = 0n] = (value as Duration).toCompact();
            view.setBigUint64(at, BigInt(secs), true);
            view.setUint32(at + 8, Number(nanos), true);
            return;
        }
        default:
            refuse("a value of a kind which has no fixed slot");
    }
}

function sized(value: unknown): number {
    return Number((value as SizedNumber).value);
}

/** The bytes of a value of a variable kind */
export function varBytes(column: Column, value: unknown, dynamic: DynamicEncoder): Uint8Array {
    switch (column.kind) {
        case Kind.String:
            return UTF8.encode(value as string);
        case Kind.Bytes:
            return value instanceof Uint8Array
                ? new Uint8Array(value)
                : new Uint8Array(value as ArrayBuffer);
        case Kind.Decimal:
            return UTF8.encode((value as Decimal).toString());
        case Kind.Dynamic:
            return dynamic(value);
        case Kind.Record:
            return recordBytes(value as RecordId, column.table, dynamic);
        case Kind.Array:
            return arrayBytes(value as unknown[], column.element as Kind, dynamic);
        default:
            return refuse("a value of a kind which has no var slot");
    }
}

/** A record slice: its key kind, the table when the column does not name one, then the id */
export function recordBytes(
    id: RecordId,
    columnTable: string,
    dynamic: DynamicEncoder,
): Uint8Array {
    const key = id.id;
    const out = new ByteWriter();

    // A key which is not one of the three the slot can hold goes as key kind 3, the whole
    // record id as one CBOR item. That is an array or an object, and also a number past the
    // range of the i64 slot, which would otherwise be wrapped into it silently — as one CBOR
    // item the codec refuses it, exactly as it refuses the same value anywhere else.
    if ((typeof key === "object" && !(key instanceof Uuid)) || beyondI64(key)) {
        return out.u8(3).raw(dynamic(id)).bytes;
    }

    const kind = typeof key === "string" ? 1 : key instanceof Uuid ? 2 : 0;
    out.u8(kind);
    if (columnTable === "") out.u16Text(id.table.name);

    switch (kind) {
        case 0:
            return out.i64(BigInt(key as number | bigint)).bytes;
        case 1:
            return out.raw(UTF8.encode(key as string)).bytes;
        default:
            return out.raw((key as Uuid).toUint8Array()).bytes;
    }
}

/** An array slice: its count, then its elements, all of one kind */
function arrayBytes(value: unknown[], element: Kind, dynamic: DynamicEncoder): Uint8Array {
    const out = new ByteWriter().u32(value.length);

    if (isVar(element)) {
        const slices = value.map((item) =>
            varBytes({ kind: element, table: "", element: undefined } as Column, item, dynamic),
        );

        let end = 0;
        for (const slice of slices) {
            end += slice.length;
            out.u32(end);
        }
        for (const slice of slices) out.raw(slice);
        return out.bytes;
    }

    const width = fixedWidth(element);
    if (width === undefined) refuse("an invalid array element kind");

    const bytes = new Uint8Array(width * value.length);
    const view = new DataView(bytes.buffer);
    for (let i = 0; i < value.length; i++) {
        writeFixed(view, bytes, i * width, element, value[i]);
    }

    return out.raw(bytes).bytes;
}

const UTF8 = new TextEncoder();

const I64_MIN = -(2n ** 63n);
const I64_MAX = 2n ** 63n - 1n;

/** Whether a record id's numeric key is past what its eight-byte slot can hold */
function beyondI64(key: unknown): boolean {
    if (typeof key === "bigint") return key < I64_MIN || key > I64_MAX;
    if (typeof key === "number") return !(key >= -(2 ** 63) && key < 2 ** 63);
    return false;
}
