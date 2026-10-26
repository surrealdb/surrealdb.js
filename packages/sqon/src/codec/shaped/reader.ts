import { ShapedFrameError } from "../../errors.ts";

const TEXT = new TextDecoder("utf-8", { fatal: true });

/** Refuses the bytes, naming what was wrong with them */
export function refuse(what: string): never {
    throw new ShapedFrameError(what);
}

/**
 * A cursor over a block's bytes.
 *
 * Every number in the format is little-endian and unaligned, and every one is read through
 * here, so the rest of the decoder names the kind it wants rather than its width and byte
 * order. A read past the end refuses the bytes instead of returning a short result.
 */
export class ByteReader {
    #bytes: Uint8Array;
    #view: DataView;
    #at = 0;

    constructor(bytes: Uint8Array) {
        this.#bytes = bytes;
        this.#view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    }

    /** Whether every byte has been read */
    get done(): boolean {
        return this.#at >= this.#bytes.length;
    }

    /** The bytes which remain unread */
    get rest(): Uint8Array {
        return this.#bytes.subarray(this.#at);
    }

    /** Moves the cursor to `at`, counted from the start */
    seek(at: number): this {
        if (at < 0 || at > this.#bytes.length) refuse("a slot out of range");
        this.#at = at;
        return this;
    }

    /** Takes `n` bytes, as a view over the same buffer */
    bytes(n: number): Uint8Array {
        const at = this.#take(n);
        return this.#bytes.subarray(at, at + n);
    }

    /** Takes `n` bytes as UTF-8, or refuses them naming `what` they were */
    text(n: number, what: string): string {
        return text(this.bytes(n), what);
    }

    u8(): number {
        return this.#view.getUint8(this.#take(1));
    }

    i8(): number {
        return this.#view.getInt8(this.#take(1));
    }

    u16(): number {
        return this.#view.getUint16(this.#take(2), true);
    }

    i16(): number {
        return this.#view.getInt16(this.#take(2), true);
    }

    u32(): number {
        return this.#view.getUint32(this.#take(4), true);
    }

    i32(): number {
        return this.#view.getInt32(this.#take(4), true);
    }

    u64(): bigint {
        return this.#view.getBigUint64(this.#take(8), true);
    }

    i64(): bigint {
        return this.#view.getBigInt64(this.#take(8), true);
    }

    f32(): number {
        return this.#view.getFloat32(this.#take(4), true);
    }

    f64(): number {
        return this.#view.getFloat64(this.#take(8), true);
    }

    /** An IEEE 754 binary16, which `DataView` does not read everywhere this SDK runs */
    f16(): number {
        const bits = this.u16();
        const sign = bits & 0x8000 ? -1 : 1;
        const exponent = (bits >> 10) & 0x1f;
        const fraction = bits & 0x3ff;

        if (exponent === 0) return sign * 2 ** -24 * fraction;
        if (exponent === 0x1f) return fraction ? Number.NaN : sign * Number.POSITIVE_INFINITY;
        return sign * 2 ** (exponent - 25) * (1024 + fraction);
    }

    /** Bit `at` of the bytes, counted least significant first within each byte */
    bit(at: number): boolean {
        const byte = this.#bytes[at >>> 3];
        if (byte === undefined) refuse("a bit out of range");
        return (byte & (1 << (at % 8))) !== 0;
    }

    #take(n: number): number {
        const at = this.#at;
        if (n < 0 || at + n > this.#bytes.length) refuse("bytes which run past the end");
        this.#at = at + n;
        return at;
    }
}

/**
 * A run of slices addressed by a table of where each one ends.
 *
 * `ends[i]` is where slice `i` stops, counted from the start of the slices, so slice `i` runs
 * from `ends[i - 1]` to `ends[i]` with nothing before the first. A row's var region is built
 * this way, and so are the elements of an array of a variable kind.
 */
export class Slices {
    #ends: Uint32Array;
    #bytes: Uint8Array;

    /** Reads a table of `count` ends where the reader stands, then takes the slices after it */
    constructor(r: ByteReader, count: number) {
        this.#ends = new Uint32Array(count);

        let last = 0;
        for (let i = 0; i < count; i++) {
            const end = r.u32();
            if (end < last) refuse("slice ends out of order");
            last = end;
            this.#ends[i] = end;
        }

        this.#bytes = r.bytes(last);
    }

    /** How many bytes the slices take in all */
    get length(): number {
        return this.#bytes.length;
    }

    /** How many slices there are */
    get count(): number {
        return this.#ends.length;
    }

    /** Slice `index` */
    at(index: number): Uint8Array {
        if (index >= this.#ends.length) refuse("a slot out of range");
        const end = this.#ends[index] as number;
        const start = index === 0 ? 0 : (this.#ends[index - 1] as number);
        return this.#bytes.subarray(start, end);
    }
}

/** The UTF-8 text of `bytes`, or a refusal naming `what` they were */
export function text(bytes: Uint8Array, what: string): string {
    try {
        return TEXT.decode(bytes);
    } catch {
        return refuse(`${what} that is not UTF-8`);
    }
}

/**
 * A growable buffer with one method per kind of number, the writing counterpart of
 * {@link ByteReader}. Everything this SDK writes goes through here, so the code above it names
 * what it is writing rather than its width and byte order.
 */
export class ByteWriter {
    #bytes = new Uint8Array(256);
    #view = new DataView(this.#bytes.buffer);
    #at = 0;

    /** The bytes written so far */
    get bytes(): Uint8Array {
        return this.#bytes.subarray(0, this.#at);
    }

    /** How many bytes have been written */
    get length(): number {
        return this.#at;
    }

    #room(n: number): number {
        const at = this.#at;
        if (at + n > this.#bytes.length) {
            let size = this.#bytes.length * 2;
            while (size < at + n) size *= 2;

            const grown = new Uint8Array(size);
            grown.set(this.#bytes);
            this.#bytes = grown;
            this.#view = new DataView(grown.buffer);
        }
        this.#at = at + n;
        return at;
    }

    u8(v: number): this {
        const at = this.#room(1);
        this.#view.setUint8(at, v);
        return this;
    }

    i8(v: number): this {
        const at = this.#room(1);
        this.#view.setInt8(at, v);
        return this;
    }

    u16(v: number): this {
        const at = this.#room(2);
        this.#view.setUint16(at, v, true);
        return this;
    }

    i16(v: number): this {
        const at = this.#room(2);
        this.#view.setInt16(at, v, true);
        return this;
    }

    u32(v: number): this {
        const at = this.#room(4);
        this.#view.setUint32(at, v, true);
        return this;
    }

    i32(v: number): this {
        const at = this.#room(4);
        this.#view.setInt32(at, v, true);
        return this;
    }

    u64(v: bigint): this {
        const at = this.#room(8);
        this.#view.setBigUint64(at, v, true);
        return this;
    }

    i64(v: bigint): this {
        const at = this.#room(8);
        this.#view.setBigInt64(at, v, true);
        return this;
    }

    f32(v: number): this {
        const at = this.#room(4);
        this.#view.setFloat32(at, v, true);
        return this;
    }

    f64(v: number): this {
        const at = this.#room(8);
        this.#view.setFloat64(at, v, true);
        return this;
    }

    /** An IEEE 754 binary16, which `DataView` does not write everywhere this SDK runs */
    f16(v: number): this {
        return this.u16(f16Bits(v));
    }

    raw(bytes: Uint8Array): this {
        const at = this.#room(bytes.length);
        this.#bytes.set(bytes, at);
        return this;
    }

    /** UTF-8 text behind its length as a `u16`, as a shape writes a name or a table */
    u16Text(value: string): this {
        const bytes = UTF8.encode(value);
        return this.u16(bytes.length).raw(bytes);
    }

    /** Overwrites the `u32` at `at`, for a length which is only known once its body is written */
    patchU32(at: number, v: number): this {
        this.#view.setUint32(at, v, true);
        return this;
    }
}

const UTF8 = new TextEncoder();

/** The bit pattern of `value` as an IEEE 754 binary16, rounding to nearest, ties to even */
export function f16Bits(value: number): number {
    if (Number.isNaN(value)) return 0x7e00;

    const sign = value < 0 || Object.is(value, -0) ? 0x8000 : 0;
    const v = Math.abs(value);

    if (v === Number.POSITIVE_INFINITY) return sign | 0x7c00;
    if (v === 0) return sign;

    const exponent = Math.floor(Math.log2(v));
    if (exponent < -14) {
        // Subnormal: the exponent field is zero and the fraction carries the whole value
        return sign | Math.round(v / 2 ** -24);
    }
    if (exponent > 15) return sign | 0x7c00;

    const fraction = Math.round(v / 2 ** exponent / 2 ** -10) - 1024;
    // Rounding the fraction up may carry into the exponent
    if (fraction >= 1024) return sign | ((exponent + 16) << 10);
    return sign | ((exponent + 15) << 10) | fraction;
}
