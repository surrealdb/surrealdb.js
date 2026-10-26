import { ShapedFrameError } from "../../errors.ts";

/**
 * A bounds-checked reader over a block's bytes. Every integer in the format is little-endian
 * and unaligned, so each read goes through the `DataView` rather than assuming any alignment.
 * A read past the end refuses the bytes instead of returning a short or undefined result.
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

    #need(n: number): number {
        const at = this.#at;
        if (at + n > this.#bytes.length) {
            throw new ShapedFrameError("bytes which run past the end");
        }
        this.#at = at + n;
        return at;
    }

    /** The next `n` bytes, as a view over the same buffer */
    take(n: number): Uint8Array {
        if (n < 0) throw new ShapedFrameError("a negative length");
        const at = this.#need(n);
        return this.#bytes.subarray(at, at + n);
    }

    u8(): number {
        return this.#view.getUint8(this.#need(1));
    }

    u16(): number {
        return this.#view.getUint16(this.#need(2), true);
    }

    u32(): number {
        return this.#view.getUint32(this.#need(4), true);
    }
}

const TEXT = new TextDecoder("utf-8", { fatal: true });

/** The UTF-8 text of `bytes`, or a refusal naming `what` when they are not UTF-8 */
export function text(bytes: Uint8Array, what: string): string {
    try {
        return TEXT.decode(bytes);
    } catch {
        throw new ShapedFrameError(`${what} that is not UTF-8`);
    }
}
