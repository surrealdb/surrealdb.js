import { Table } from "../../value/table.ts";
import { MAX_EMPTY_ROWS, MAX_SHAPES, MESSAGE_BATCH, MESSAGE_SHAPE, VERSION } from "./constants.ts";
import { ByteReader, refuse } from "./reader.ts";
import { Row, readRow } from "./row.ts";
import { Shape } from "./shape.ts";
import type { DynamicDecoder, ReadContext } from "./values.ts";

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
    read(block: ShapedBlock, dynamic: DynamicDecoder, nativeDates = false): unknown[] {
        const r = new ByteReader(block.contents);
        if (r.u8() !== VERSION) refuse("an unknown block version");

        const rows: unknown[] = [];
        // The tables of one block are few and repeat on every row, so they are made once here
        const tables = new Map<string, Table>();
        const ctx: ReadContext = {
            dynamic,
            nativeDates,
            table(name) {
                let table = tables.get(name);
                if (!table) {
                    table = new Table(name);
                    tables.set(name, table);
                }
                return table;
            },
        };

        while (!r.done) {
            const type = r.u8();
            const payload = new ByteReader(r.bytes(r.u32()));

            switch (type) {
                case MESSAGE_SHAPE:
                    this.#announce(payload);
                    break;
                case MESSAGE_BATCH:
                    this.#batch(payload, rows, ctx);
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
    #batch(payload: ByteReader, rows: unknown[], ctx: ReadContext): void {
        const id = payload.u32();
        const count = payload.u32();

        const shape = this.#shapes.get(id);
        if (!shape) refuse("a batch of an unannounced shape");

        // A row of a zero-width shape takes no bytes, so the payload cannot bound the count; a
        // batch of them is bounded by its own limit instead
        if (shape.headerLength === 0 && count > MAX_EMPTY_ROWS) {
            refuse("a batch of too many empty rows");
        }

        // One cursor reads every row of the batch, moved along by what each row takes
        const bytes = payload.rest;
        const row = new Row(shape, bytes, ctx);

        let at = 0;
        for (let i = 0; i < count; i++) {
            const used = row.seek(at);
            rows.push(row.read());
            at += used;
        }

        if (at !== bytes.length) refuse("bytes past a batch's rows");
    }
}

/** One row of `shape` at the start of `bytes`: its value, and the bytes it took */
export function decodeRow(
    shape: Shape,
    bytes: Uint8Array,
    dynamic: DynamicDecoder,
    nativeDates = false,
): [unknown, number] {
    // One row on its own has no batch to share tables with, so it makes its own
    return readRow(shape, bytes, { dynamic, nativeDates, table: (name) => new Table(name) });
}
