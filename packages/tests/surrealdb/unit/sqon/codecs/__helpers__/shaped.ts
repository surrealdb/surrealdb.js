/**
 * A writer for shaped blocks, used by the shaped decoder's tests.
 *
 * The SDK only reads blocks — the server writes them — so this lives with the tests rather
 * than in the package. It writes the format of `doc/design/shaped-frames.md` directly, so a
 * test states the bytes it means rather than the calls which happen to produce them.
 */

import { CborCodec, Kind, MAY_BE_ABSENT, MAY_BE_NULL, NO_SLOT } from "@surrealdb/sqon";

const cbor = new CborCodec({ version: 2 });

/** A column of a shape, with the defaults a leaf column usually takes */
export interface ColumnSpec {
    name: string;
    /** A raw code as well as a `Kind`, so a test can write one the decoder does not know */
    kind: Kind | number;
    element?: Kind | number;
    flags?: number;
    presence?: number;
    slot?: number;
    table?: string;
    children?: number;
    rest?: number;
}

/** A shape, as the SHAPE message lists it */
export interface ShapeSpec {
    root?: 0 | 1;
    presenceBits?: number;
    fixedSize?: number;
    varCount?: number;
    rootRest?: number;
    columns?: ColumnSpec[];
}

class Bytes {
    #parts: number[] = [];

    u8(v: number): this {
        this.#parts.push(v & 0xff);
        return this;
    }

    u16(v: number): this {
        return this.u8(v).u8(v >>> 8);
    }

    u32(v: number): this {
        return this.u16(v & 0xffff).u16(v >>> 16);
    }

    raw(bytes: Uint8Array | number[]): this {
        for (const b of bytes) this.#parts.push(b & 0xff);
        return this;
    }

    text(value: string): this {
        return this.raw(new TextEncoder().encode(value));
    }

    get bytes(): Uint8Array {
        return new Uint8Array(this.#parts);
    }

    get length(): number {
        return this.#parts.length;
    }
}

/** The SHAPE payload of `spec`, past its shape id */
export function shapePayload(spec: ShapeSpec): Uint8Array {
    const columns = spec.columns ?? [];
    const out = new Bytes()
        .u8(spec.root ?? 0)
        .u32(spec.presenceBits ?? 0)
        .u32(spec.fixedSize ?? 0)
        .u32(spec.varCount ?? 0)
        .u32(spec.rootRest ?? NO_SLOT)
        .u32(columns.length);

    for (const column of columns) {
        const name = new TextEncoder().encode(column.name);
        const table = new TextEncoder().encode(column.table ?? "");

        out.u16(name.length)
            .raw(name)
            .u8(column.kind)
            .u8(column.element ?? 0)
            .u8(column.flags ?? 0)
            .u32(column.presence ?? NO_SLOT)
            .u32(column.slot ?? NO_SLOT)
            .u16(table.length)
            .raw(table)
            .u32(column.children ?? 0)
            .u32(column.rest ?? NO_SLOT);
    }

    return out.bytes;
}

/** A message: its type, its length, and its payload */
function message(type: number, payload: Uint8Array): Uint8Array {
    return new Bytes().u8(type).u32(payload.length).raw(payload).bytes;
}

/** A SHAPE message announcing `spec` under `id` */
export function shapeMessage(id: number, spec: ShapeSpec): Uint8Array {
    return message(0x01, new Bytes().u32(id).raw(shapePayload(spec)).bytes);
}

/** A BATCH message of `rows`, written in the shape announced under `id` */
export function batchMessage(id: number, rows: Uint8Array[]): Uint8Array {
    const out = new Bytes().u32(id).u32(rows.length);
    for (const row of rows) out.raw(row);
    return message(0x02, out.bytes);
}

/** A block: its version byte and `messages`, wrapped in the CBOR tag 57 byte string */
export function block(...messages: Uint8Array[]): Uint8Array {
    const contents = new Bytes().u8(1);
    for (const m of messages) contents.raw(m);
    return taggedByteString(contents.bytes);
}

/** A block's contents without the CBOR wrapper, for decoding a block directly */
export function blockContents(...messages: Uint8Array[]): Uint8Array {
    const contents = new Bytes().u8(1);
    for (const m of messages) contents.raw(m);
    return contents.bytes;
}

/** `bytes` as CBOR tag 57 around a definite-length byte string, as the server writes it */
export function taggedByteString(bytes: Uint8Array): Uint8Array {
    return new Bytes()
        .raw([0xd8, 0x39, 0x5a])
        .u8(bytes.length >>> 24)
        .u8(bytes.length >>> 16)
        .u8(bytes.length >>> 8)
        .u8(bytes.length)
        .raw(bytes).bytes;
}

/** How a row is built: its presence bits, its fixed region, and its var slices in slot order */
export interface RowSpec {
    presence?: number[];
    fixed?: Uint8Array | number[];
    vars?: (Uint8Array | number[])[];
}

/** One row: its presence region, fixed region, ends table and var region */
export function row(spec: RowSpec): Uint8Array {
    const out = new Bytes();
    for (const byte of spec.presence ?? []) out.u8(byte);
    out.raw(spec.fixed ?? []);

    const vars = (spec.vars ?? []).map((v) => (v instanceof Uint8Array ? v : new Uint8Array(v)));
    let end = 0;
    for (const slice of vars) {
        end += slice.length;
        out.u32(end);
    }
    for (const slice of vars) out.raw(slice);

    return out.bytes;
}

/** A little-endian fixed region built from sized writes */
export class Fixed {
    #bytes: Uint8Array;
    #view: DataView;

    constructor(size: number) {
        this.#bytes = new Uint8Array(size);
        this.#view = new DataView(this.#bytes.buffer);
    }

    u8(at: number, v: number): this {
        this.#view.setUint8(at, v);
        return this;
    }

    i8(at: number, v: number): this {
        this.#view.setInt8(at, v);
        return this;
    }

    u16(at: number, v: number): this {
        this.#view.setUint16(at, v, true);
        return this;
    }

    i16(at: number, v: number): this {
        this.#view.setInt16(at, v, true);
        return this;
    }

    u32(at: number, v: number): this {
        this.#view.setUint32(at, v, true);
        return this;
    }

    i32(at: number, v: number): this {
        this.#view.setInt32(at, v, true);
        return this;
    }

    i64(at: number, v: bigint): this {
        this.#view.setBigInt64(at, v, true);
        return this;
    }

    u64(at: number, v: bigint): this {
        this.#view.setBigUint64(at, v, true);
        return this;
    }

    f32(at: number, v: number): this {
        this.#view.setFloat32(at, v, true);
        return this;
    }

    f64(at: number, v: number): this {
        this.#view.setFloat64(at, v, true);
        return this;
    }

    raw(at: number, bytes: Uint8Array | number[]): this {
        this.#bytes.set(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), at);
        return this;
    }

    get bytes(): Uint8Array {
        return this.#bytes;
    }
}

/** A value encoded as one `cbor.2` item, as a dynamic slice holds it */
export function dynamic(value: unknown): Uint8Array {
    return cbor.encode(value);
}

/** UTF-8 bytes */
export function utf8(value: string): Uint8Array {
    return new TextEncoder().encode(value);
}

/** A record slice of a number id */
export function recordNumber(id: bigint, table?: string): Uint8Array {
    const out = new Bytes().u8(0);
    if (table !== undefined) {
        const name = utf8(table);
        out.u16(name.length).raw(name);
    }
    const buf = new Uint8Array(8);
    new DataView(buf.buffer).setBigInt64(0, id, true);
    return out.raw(buf).bytes;
}

/** A record slice of a string id */
export function recordString(id: string, table?: string): Uint8Array {
    const out = new Bytes().u8(1);
    if (table !== undefined) {
        const name = utf8(table);
        out.u16(name.length).raw(name);
    }
    return out.raw(utf8(id)).bytes;
}

/** An array slice of elements of a variable kind */
export function varArray(elements: Uint8Array[]): Uint8Array {
    const out = new Bytes().u32(elements.length);
    let end = 0;
    for (const element of elements) {
        end += element.length;
        out.u32(end);
    }
    for (const element of elements) out.raw(element);
    return out.bytes;
}

/** An array slice of elements of a fixed kind, already written */
export function fixedArray(count: number, bytes: Uint8Array): Uint8Array {
    return new Bytes().u32(count).raw(bytes).bytes;
}

export { MAY_BE_ABSENT, MAY_BE_NULL, NO_SLOT, Kind };
