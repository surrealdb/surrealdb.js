import { Encoded } from "@surrealdb/cbor";
import { ShapedFrameError } from "../../errors.ts";
import { CborCodec, type CborCodecOptions } from "../cbor/codec.ts";
import type { BlockReader } from "./block.ts";
import { ShapedBlock } from "./block.ts";
import { Columns } from "./columnar.ts";
import { SHAPED_TAG } from "./constants.ts";
import { Kind } from "./kinds.ts";
import { ByteWriter } from "./reader.ts";
import type { Shape } from "./shape.ts";
import type { DynamicDecoder } from "./values.ts";
import { writeBlock } from "./write.ts";

/**
 * How many rows an array needs before it is worth sending as a block. Below this the shape
 * costs more than the keys it saves, since a shape names every column once however few rows
 * follow it.
 */
export const BLOCK_THRESHOLD = 32;

/**
 * How many rows are measured to decide whether a block is worth writing. Rows which share a
 * shape are alike, so a sample spread across the array settles it without encoding all of it.
 */
const SAMPLE = 64;

/** Options for the shaped codec */
export interface ShapedCodecOptions extends Omit<CborCodecOptions, "version"> {
    /**
     * The fewest rows an array must hold before it is sent as a block rather than as a CBOR
     * array. `Infinity` never sends one, which leaves this codec reading blocks only.
     *
     * @default 32
     */
    blockThreshold?: number;
}

/**
 * The codec of the `shaped` format: `cbor.2`, plus the tag 57 blocks which carry a list of rows.
 *
 * Everything which is not a row list — the response envelope, `begin`, `value`, `finished` and
 * `end` stream frames, a notification's `id`, `action` and `record`, errors — is `cbor.2` as
 * the CBOR codec writes it, so this codec is that codec with one tag added.
 *
 * **Reading.** Tag 57 decodes to a {@link ShapedBlock}, which still holds its bytes. The shape
 * ids in a block are resolved against a scope wider than the block itself, so the caller reads
 * a block through the {@link BlockReader} of its scope once the envelope says which scope that
 * is.
 *
 * **Writing.** The server reads a block wherever a CBOR request holds a value — an RPC
 * parameter, a query variable — so an array of rows long enough to be worth it is sent as one.
 * A shape is derived from the rows themselves, since a client is not told the schema of what it
 * sends; what no column can describe goes in a `dynamic` column. Only a connection which
 * negotiated `shaped` uses this codec, which is also how the SDK knows the server is one that
 * reads blocks at all: a server before 4.0 refuses tag 57 as an unknown tag.
 */
export class ShapedCodec extends CborCodec {
    #threshold: number;

    constructor(options: ShapedCodecOptions = {}) {
        super({ ...options, version: 2 });
        this.#threshold = options.blockThreshold ?? BLOCK_THRESHOLD;

        // Set here rather than as a field: the base class holds `tagged` as an instance field,
        // which a subclass field initializer would replace wholesale rather than add to.
        this.tagged = {
            ...this.tagged,
            [SHAPED_TAG]: (v) => {
                // A CBOR byte string decodes to an ArrayBuffer
                if (v instanceof ArrayBuffer) return new ShapedBlock(new Uint8Array(v));
                if (v instanceof Uint8Array) return new ShapedBlock(v);
                throw new ShapedFrameError("a block that is not a byte string");
            },
        };
    }

    /** A decoder for the one CBOR item a dynamic slice holds */
    get dynamic(): DynamicDecoder {
        return (bytes) => this.decode(bytes);
    }

    /** The rows of `block`, read in `scope` */
    rows(block: ShapedBlock, scope: BlockReader): unknown[] {
        return scope.read(block, this.dynamic);
    }

    override encode<T>(data: T): Uint8Array {
        return super.encode(this.#shapeRows(data));
    }

    /**
     * `value` with every array of rows long enough to be worth it replaced by the block which
     * carries it. A block cannot nest — a dynamic slice is read as strict CBOR, which refuses
     * tag 57 — so an array which becomes a block is not descended into.
     */
    #shapeRows(value: unknown): unknown {
        if (Array.isArray(value)) {
            const block = this.block(value);
            if (block) return new Encoded(block);

            return value.map((item) => this.#shapeRows(item));
        }

        if (
            typeof value === "object" &&
            value !== null &&
            Object.getPrototypeOf(value) === Object.prototype
        ) {
            const out: Record<string, unknown> = {};
            for (const [key, item] of Object.entries(value)) out[key] = this.#shapeRows(item);
            return out;
        }

        return value;
    }

    /**
     * `rows` as the bytes of a tag 57 block, or `undefined` when they are not worth sending as
     * one: too few, not an array of objects, or a block which would be no smaller than the
     * CBOR array it replaces.
     *
     * That last case is real rather than theoretical. A shape gives every column a fixed width,
     * so a column of small integers takes eight bytes a row where CBOR takes one or two, and a
     * block of them is larger than the array. The server does not meet this because its shapes
     * come from a table's field definitions over rows already stored in that layout; a client
     * deriving a shape from the values in hand does. So the block is written and measured, and
     * kept only if it actually won.
     */
    block(rows: readonly unknown[]): Uint8Array | undefined {
        if (rows.length < this.#threshold) return undefined;

        // One read of the rows settles their shape and keeps what writing them needs, so
        // deciding whether to send a block costs nothing the block itself would not have cost
        const columns = Columns.collect(rows);
        if (!columns) return undefined;

        const shape = columns.shape;

        // A shape whose every column is dynamic saves nothing: the rows are still whole CBOR
        // items, and the block only adds its own framing on top
        if (shape.columns.every((column) => column.kind === Kind.Dynamic)) return undefined;

        if (!this.#worthIt(shape, rows)) return undefined;
        return tagged(columns.write((item) => super.encode(item)));
    }

    /**
     * Whether writing `rows` in `shape` comes out smaller than the CBOR array would.
     *
     * Deciding it by encoding the whole array both ways is exact but costs a full CBOR encode
     * on top of the write, which made sending a block slower than not sending one. Rows which
     * share a shape are alike by construction, so the question is settled on a sample spread
     * across the array instead, and only short arrays are measured whole.
     */
    #worthIt(shape: Shape, rows: readonly unknown[]): boolean {
        // A short array is measured whole, so the answer is exactly the one which matters
        if (rows.length <= SAMPLE) {
            const asBlock = writeBlock(shape, rows, (item) => super.encode(item)).length;
            return asBlock < super.encode(rows).length;
        }

        const stride = Math.floor(rows.length / SAMPLE);
        const sample: unknown[] = [];
        for (let i = 0; i < rows.length && sample.length < SAMPLE; i += stride) {
            sample.push(rows[i]);
        }

        const asBlock = writeBlock(shape, sample, (item) => super.encode(item)).length;
        const asArray = super.encode(sample).length;

        // The shape is written once however many rows follow it, so the sample's rows are what
        // scales and the shape is added back once. Everything else — the block's framing, the
        // array's head — is small and counted in the per-row rate, which only makes the block
        // look slightly worse than it is.
        const shapeBytes = shape.encode().length;
        const perBlockRow = (asBlock - shapeBytes) / sample.length;
        const perArrayRow = asArray / sample.length;

        return shapeBytes + perBlockRow * rows.length < perArrayRow * rows.length;
    }
}

/** `contents` as CBOR tag 57 around a definite-length byte string, as the server writes one */
function tagged(contents: Uint8Array): Uint8Array {
    // The head is three bytes of tag and byte-string marker and four of length
    return (
        new ByteWriter(7 + contents.length)
            .u8(0xd8)
            .u8(0x39)
            .u8(0x5a)
            // A byte string's length is big-endian, as every CBOR head is
            .u8(contents.length >>> 24)
            .u8((contents.length >>> 16) & 0xff)
            .u8((contents.length >>> 8) & 0xff)
            .u8(contents.length & 0xff)
            .raw(contents).bytes
    );
}
