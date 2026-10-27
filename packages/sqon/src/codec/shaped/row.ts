import {
    MAY_BE_ABSENT,
    MAY_BE_NULL,
    NO_SLOT,
    presenceWidth,
    ROOT_VALUE,
    STATE_ABSENT,
    STATE_NONE,
    STATE_NULL,
    STATE_VALUE,
} from "./constants.ts";
import { isVar, Kind } from "./kinds.ts";
import { refuse } from "./reader.ts";
import type { Column, Shape } from "./shape.ts";
import {
    datetimeNs,
    durationNs,
    dynamic,
    fixedValue,
    type ReadContext,
    varValue,
} from "./values.ts";

/**
 * A cursor over the rows of one batch:
 *
 * ```
 * row = presence[ceil(presence_bits / 8)]  fixed[fixed_size]  ends[var_count]:u32  var[L]
 * ```
 *
 * The presence region says, for each column which may be missing, whether it holds a value, is
 * absent, is `NULL`, or is present and `NONE`. The fixed region holds the slots of the fixed
 * kinds at the offsets the shape gave them, and the var region holds the slices of the variable
 * ones, addressed through the ends table.
 *
 * One cursor reads every row of a batch. A row is read where it lies rather than being cut out
 * of the batch first, so reading a row allocates what the row's values need and nothing else:
 * the regions are offsets into the batch's own bytes, and the ends table is read into a buffer
 * the cursor keeps.
 */
export class Row {
    #shape: Shape;
    #ctx: ReadContext;
    #bytes: Uint8Array;
    #view: DataView;
    /** The ends of this row's var slices, reused from row to row */
    #ends: Uint32Array;

    /** Where this row's regions begin, counted from the start of the batch */
    #presenceAt = 0;
    #fixedAt = 0;
    #varAt = 0;

    constructor(shape: Shape, bytes: Uint8Array, ctx: ReadContext) {
        this.#shape = shape;
        this.#ctx = ctx;
        this.#bytes = bytes;
        this.#view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        this.#ends = new Uint32Array(shape.varCount);
    }

    /**
     * Points the cursor at the row which begins at `at`, and returns how many bytes it takes.
     *
     * Everything a value reads afterwards lies inside those bytes: the shape has already been
     * checked, so every slot it names is inside the region it belongs to, and this bounds the
     * regions themselves against the batch.
     */
    seek(at: number): number {
        const shape = this.#shape;
        const header = shape.headerLength;
        if (at + header > this.#bytes.length) refuse("a truncated row");

        this.#presenceAt = at;
        this.#fixedAt = at + shape.presenceLength;
        const endsAt = this.#fixedAt + shape.fixedSize;
        this.#varAt = at + header;

        // Every presence bit past the last state the shape uses is zero, and only the region's
        // last byte can hold one, so the shape's mask settles it in a single read
        const mask = shape.paddingMask;
        if (mask !== 0) {
            const last = this.#view.getUint8(this.#fixedAt - 1);
            if ((last & mask) !== 0) refuse("presence padding bits set");
        }

        let last = 0;
        for (let i = 0; i < shape.varCount; i++) {
            const end = this.#view.getUint32(endsAt + 4 * i, true);
            if (end < last) refuse("var ends out of order");
            last = end;
            this.#ends[i] = end;
        }

        const total = header + last;
        if (at + total > this.#bytes.length) refuse("a truncated row");
        return total;
    }

    /** The row the cursor points at */
    read(): unknown {
        return this.#shape.root === ROOT_VALUE
            ? dynamic(this.slice(this.#shape.rootRest), this.#ctx)
            : this.node(undefined);
    }

    /** The object a node builds: the entries of its remainder, then its columns */
    node(node: number | undefined): Record<string, unknown> {
        // A node with no remainder starts from an empty object, and a column cannot collide
        // with a key which is not there: only a remainder's keys can, so only then is it asked
        const open = this.#shape.rest(node) !== NO_SLOT;
        const object = open ? this.#remainder(node) : {};
        const columns = this.#shape.columns;
        const children = this.#shape.children(node);

        for (let i = 0; i < children.length; i++) {
            const at = children[i] as number;
            const column = columns[at] as Column;
            const state = this.#state(column);

            if (state === STATE_ABSENT && (column.flags & MAY_BE_ABSENT) !== 0) continue;

            if (open && Object.hasOwn(object, column.name)) {
                refuse("a remainder key that has a column");
            }
            object[column.name] = this.#stated(at, column, state);
        }

        return object;
    }

    /** What a column holds, given the state its presence bits put it in */
    #stated(at: number, column: Column, state: number): unknown {
        switch (state) {
            case STATE_VALUE:
                return this.#value(at, column);
            case STATE_NULL:
                if ((column.flags & MAY_BE_NULL) !== 0) return null;
                break;
            case STATE_NONE:
                // The row holds the key and its value is NONE, which is its own state so that
                // it round-trips as NONE rather than as a key the row does not hold
                if ((column.flags & MAY_BE_ABSENT) !== 0) return undefined;
                break;
        }
        return refuse("a presence state the column does not allow");
    }

    /** The value of a column whose presence says it holds one */
    #value(at: number, column: Column): unknown {
        const slot = column.slot;

        switch (column.kind) {
            case Kind.Object:
                return this.node(at);
            case Kind.Bit:
                return this.#bit(this.#fixedAt, slot);
            case Kind.DatetimeNs:
                return datetimeNs(
                    this.#view,
                    this.#fixedAt + slot,
                    () => this.slice(column.rest),
                    this.#ctx,
                );
            case Kind.DurationNs:
                return durationNs(
                    this.#view,
                    this.#fixedAt + slot,
                    () => this.slice(column.rest),
                    this.#ctx,
                );
            default:
                // Object and bit are above, so what is left is held either at a byte offset in
                // the fixed region or in a var slice
                return isVar(column.kind)
                    ? varValue(
                          column.kind,
                          this.slice(slot),
                          this.#ctx,
                          column.table,
                          column.element,
                      )
                    : fixedValue(column.kind, this.#view, this.#fixedAt + slot, this.#ctx);
        }
    }

    /** The bytes of var slot `slot` of this row */
    slice(slot: number): Uint8Array {
        if (slot >= this.#ends.length) refuse("a var slot out of range");

        const end = this.#ends[slot] as number;
        const start = slot === 0 ? 0 : (this.#ends[slot - 1] as number);
        return this.#bytes.subarray(this.#varAt + start, this.#varAt + end);
    }

    /** The entries of `node`'s remainder: the keys it holds which have no column */
    #remainder(node: number | undefined): Record<string, unknown> {
        const rest = this.#shape.rest(node);
        if (rest === NO_SLOT) return {};

        const slice = this.slice(rest);
        if (slice.length === 0) return {};

        // The decoded remainder is freshly built and held by nobody else, so the node's columns
        // are added to it rather than to a copy of it
        const entries = dynamic(slice, this.#ctx);
        const proto =
            typeof entries === "object" && entries !== null
                ? Object.getPrototypeOf(entries)
                : false;

        if (proto !== Object.prototype && proto !== null) {
            refuse("a remainder that is not an object");
        }
        return entries as Record<string, unknown>;
    }

    /** `column`'s presence state, read from the bits its flags give it */
    #state(column: Column): number {
        const at = column.presence;
        switch (presenceWidth(column.flags)) {
            case 0:
                return STATE_VALUE;
            case 1:
                // One bit, set for a value; clear means whichever of the two the flag allows
                if (this.#bit(this.#presenceAt, at)) return STATE_VALUE;
                return (column.flags & MAY_BE_ABSENT) !== 0 ? STATE_ABSENT : STATE_NULL;
            default:
                return (
                    (this.#bit(this.#presenceAt, at) ? 1 : 0) |
                    ((this.#bit(this.#presenceAt, at + 1) ? 1 : 0) << 1)
                );
        }
    }

    /** Bit `at` of the region which begins at `base`, least significant first within a byte */
    #bit(base: number, at: number): boolean {
        return (this.#view.getUint8(base + (at >>> 3)) & (1 << (at % 8))) !== 0;
    }
}

/** One row of `shape` at the start of `bytes`: its value, and the bytes it took */
export function readRow(shape: Shape, bytes: Uint8Array, ctx: ReadContext): [unknown, number] {
    const row = new Row(shape, bytes, ctx);
    const used = row.seek(0);
    return [row.read(), used];
}
