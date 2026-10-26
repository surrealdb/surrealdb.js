import { Encoded } from "@surrealdb/cbor";
import { ShapedFrameError } from "../../errors.ts";
import { CborCodec, type CborCodecOptions } from "../cbor/codec.ts";
import type { BlockReader } from "./block.ts";
import { ShapedBlock } from "./block.ts";
import { Columns } from "./columnar.ts";
import { SHAPED_TAG } from "./constants.ts";
import { Kind } from "./kinds.ts";
import { define } from "./object.ts";
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

/**
 * The bytes `tagged` puts in front of a block: the tag 57 head and the byte string's
 * four-byte length. The block goes on the wire inside them, so a comparison which leaves them
 * out can keep a block which is larger than the array it replaced.
 */
const TAG_HEAD = 7;

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
    #nativeDates: boolean;
    #visitor: ((value: unknown) => unknown) | undefined;
    #visits: boolean;

    constructor(options: ShapedCodecOptions = {}) {
        super({ ...options, version: 2 });
        this.#threshold = options.blockThreshold ?? BLOCK_THRESHOLD;
        this.#nativeDates = options.useNativeDates === true;
        this.#visitor = options.valueDecodeVisitor;

        // A visitor is applied by the CBOR encoder as it walks the values. A block writes its
        // columns itself and never reaches that walk, so a row in a block would come out
        // unvisited while the same row in a plain array came out visited — the same request
        // serialised two ways depending on how long the array was. Rather than visit twice,
        // and risk the two disagreeing, a codec with a visitor does not write blocks at all.
        this.#visits = options.valueEncodeVisitor !== undefined;

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
        return scope.read(block, this.dynamic, {
            nativeDates: this.#nativeDates,
            visit: this.#visitor,
        });
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
            // Every object of a request passes through here, block or no block, so a field
            // named `__proto__` is defined rather than assigned: assigning it would make the
            // clone's prototype out of the value and drop the field before it is ever encoded
            const out: Record<string, unknown> = {};
            for (const [key, item] of Object.entries(value)) {
                define(out, key, this.#shapeRows(item));
            }
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
        if (rows.length < this.#threshold || this.#visits) return undefined;

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
        // A short array is measured whole, so the answer is exactly the one which matters.
        // What goes on the wire is the block inside its tag 57 head, so that is what is
        // measured: the contents alone can be smaller than the array while the request is not.
        if (rows.length <= SAMPLE) {
            const asBlock = writeBlock(shape, rows, (item) => super.encode(item)).length;
            return asBlock + TAG_HEAD < super.encode(rows).length;
        }

        // The indices are scattered rather than stepped. Any arithmetic progression — one row
        // every stride, or runs beginning every stride — shares a period with the data when
        // the data has one, and then the sample sees only one phase of it: rows alternating
        // large and small, or clustered eight and eight, read as if they were all large.
        // Multiplying by an odd constant and wrapping visits the array in an order which lines
        // up with no period, and is still settled only by the array's length.
        const sample: unknown[] = [];
        const n = rows.length;
        for (let i = 0; i < SAMPLE; i++) {
            sample.push(rows[((i * 0x9e3779b1) >>> 0) % n]);
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

        return shapeBytes + TAG_HEAD + perBlockRow * rows.length < perArrayRow * rows.length;
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
