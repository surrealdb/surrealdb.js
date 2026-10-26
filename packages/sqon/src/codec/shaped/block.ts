import { MAX_EMPTY_ROWS, MAX_SHAPES, MESSAGE_BATCH, MESSAGE_SHAPE, VERSION } from "./constants.ts";
import { ByteReader, refuse } from "./reader.ts";
import { Row } from "./row.ts";
import { Shape } from "./shape.ts";
import type { DynamicDecoder } from "./values.ts";

export type { DynamicDecoder };

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
 * ```
 * block    = version:u8  message*
 * message  = type:u8  length:u32  payload[length]
 * SHAPE    = shape_id:u32  shape
 * BATCH    = shape_id:u32  row_count:u32  row[row_count]
 * ```
 *
 * A SHAPE announces a shape under an id; the batches after it name the shape by that id, in the
 * same block or in a later one of the same scope. Announcing an id again replaces it for the
 * batches which follow.
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
        if (r.u8() !== VERSION) refuse("an unknown block version");

        const rows: unknown[] = [];

        while (!r.done) {
            const type = r.u8();
            const payload = new ByteReader(r.bytes(r.u32()));

            switch (type) {
                case MESSAGE_SHAPE:
                    this.#announce(payload);
                    break;
                case MESSAGE_BATCH:
                    this.#batch(payload, rows, { dynamic });
                    break;
                default:
                    // A message this version does not know is skipped
                    break;
            }
        }

        return rows;
    }

    /** SHAPE: the shape is checked once here, so the rows which name it need not be */
    #announce(payload: ByteReader): void {
        const id = payload.u32();
        const shape = Shape.decode(payload.rest);

        if (!this.#shapes.has(id) && this.#shapes.size >= MAX_SHAPES) {
            refuse("too many shapes in one scope");
        }

        this.#shapes.set(id, shape);
    }

    /** BATCH: rows of one announced shape, back to back, each one as long as its own bytes say */
    #batch(payload: ByteReader, rows: unknown[], ctx: { dynamic: DynamicDecoder }): void {
        const id = payload.u32();
        const count = payload.u32();

        const shape = this.#shapes.get(id);
        if (!shape) refuse("a batch of an unannounced shape");

        // A row of a zero-width shape takes no bytes, so the payload cannot bound the count; a
        // batch of them is bounded by its own limit instead
        if (shape.headerLength === 0 && count > MAX_EMPTY_ROWS) {
            refuse("a batch of too many empty rows");
        }

        let bytes = payload.rest;
        for (let i = 0; i < count; i++) {
            const [value, used] = Row.read(shape, bytes, ctx);
            rows.push(value);
            bytes = bytes.subarray(used);
        }

        if (bytes.length !== 0) refuse("bytes past a batch's rows");
    }
}

/** One row of `shape` at the start of `bytes`: its value, and the bytes it took */
export function decodeRow(
    shape: Shape,
    bytes: Uint8Array,
    dynamic: DynamicDecoder,
): [unknown, number] {
    return Row.read(shape, bytes, { dynamic });
}
