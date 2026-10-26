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
import { ByteReader, refuse, Slices } from "./reader.ts";
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
 * One row of a shape:
 *
 * ```
 * row = presence[ceil(presence_bits / 8)]  fixed[fixed_size]  ends[var_count]:u32  var[L]
 * ```
 *
 * The presence region says, for each column which may be missing, whether it holds a value, is
 * absent, is `NULL`, or is present and `NONE`. The fixed region holds the slots of the fixed
 * kinds at the offsets the shape gave them, and the var region holds the slices of the variable
 * ones, addressed through the ends table.
 */
export class Row {
    #shape: Shape;
    #presence: ByteReader;
    #fixed: ByteReader;
    #slices: Slices;
    #ctx: ReadContext;

    private constructor(
        shape: Shape,
        presence: ByteReader,
        fixed: ByteReader,
        slices: Slices,
        ctx: ReadContext,
    ) {
        this.#shape = shape;
        this.#presence = presence;
        this.#fixed = fixed;
        this.#slices = slices;
        this.#ctx = ctx;
    }

    /** The row at the start of `bytes`: its value, and the bytes it took */
    static read(shape: Shape, bytes: Uint8Array, ctx: ReadContext): [unknown, number] {
        if (bytes.length < shape.headerLength) refuse("a truncated row");

        const r = new ByteReader(bytes);
        const presence = new ByteReader(r.bytes(shape.presenceLength));
        const fixed = new ByteReader(r.bytes(shape.fixedSize));
        const slices = new Slices(r, shape.varCount);

        checkPadding(presence, shape);

        const row = new Row(shape, presence, fixed, slices, ctx);
        const value =
            shape.root === ROOT_VALUE
                ? dynamic(slices.at(shape.rootRest), ctx)
                : row.node(undefined);

        return [value, shape.headerLength + slices.length];
    }

    /** The object a node builds: the entries of its remainder, then its columns */
    node(node: number | undefined): Record<string, unknown> {
        const object = this.#remainder(node);

        for (const at of this.#shape.children(node)) {
            const column = this.#shape.columns[at] as Column;
            const state = this.#state(column);

            if (state === STATE_ABSENT && this.#allows(column, MAY_BE_ABSENT)) continue;

            if (Object.hasOwn(object, column.name)) {
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
                if (this.#allows(column, MAY_BE_NULL)) return null;
                break;
            case STATE_NONE:
                // The row holds the key and its value is NONE, which is its own state so that
                // it round-trips as NONE rather than as a key the row does not hold
                if (this.#allows(column, MAY_BE_ABSENT)) return undefined;
                break;
        }
        return refuse("a presence state the column does not allow");
    }

    /** The value of a column whose presence says it holds one */
    #value(at: number, column: Column): unknown {
        switch (column.kind) {
            case Kind.Object:
                return this.node(at);
            case Kind.Bit:
                return this.#fixed.bit(column.slot);
            case Kind.DatetimeNs:
                return datetimeNs(this.#at(column.slot), () => this.#slices.at(column.rest));
            case Kind.DurationNs:
                return durationNs(this.#at(column.slot), () => this.#slices.at(column.rest));
            default:
                // Object and bit are above, so what is left is held either at a byte offset in
                // the fixed region or in a var slice
                return isVar(column.kind)
                    ? varValue(
                          column.kind,
                          this.#slices.at(column.slot),
                          this.#ctx,
                          column.table,
                          column.element,
                      )
                    : fixedValue(column.kind, this.#at(column.slot));
        }
    }

    /** The entries of `node`'s remainder: the keys it holds which have no column */
    #remainder(node: number | undefined): Record<string, unknown> {
        const rest = this.#shape.rest(node);
        if (rest === NO_SLOT) return {};

        const slice = this.#slices.at(rest);
        if (slice.length === 0) return {};

        const entries = dynamic(slice, this.#ctx);
        const proto =
            typeof entries === "object" && entries !== null
                ? Object.getPrototypeOf(entries)
                : false;

        if (proto !== Object.prototype && proto !== null) {
            refuse("a remainder that is not an object");
        }
        return { ...(entries as Record<string, unknown>) };
    }

    /** `column`'s presence state, read from the bits its flags give it */
    #state(column: Column): number {
        const at = column.presence;
        switch (presenceWidth(column.flags)) {
            case 0:
                return STATE_VALUE;
            case 1:
                // One bit, set for a value; clear means whichever of the two the flag allows
                if (this.#presence.bit(at)) return STATE_VALUE;
                return this.#allows(column, MAY_BE_ABSENT) ? STATE_ABSENT : STATE_NULL;
            default:
                return (
                    (this.#presence.bit(at) ? 1 : 0) | ((this.#presence.bit(at + 1) ? 1 : 0) << 1)
                );
        }
    }

    #allows(column: Column, flag: number): boolean {
        return (column.flags & flag) !== 0;
    }

    /** The fixed region, positioned at `slot` */
    #at(slot: number): ByteReader {
        return this.#fixed.seek(slot);
    }
}

/** Every presence bit past the last state a shape uses is zero */
function checkPadding(presence: ByteReader, shape: Shape): void {
    for (let at = 0; at < shape.presenceLength; at++) {
        const low = 8 * at;
        if (low + 8 <= shape.presenceBits) continue;

        const keep = Math.max(shape.presenceBits - low, 0);
        if (presence.seek(at).u8() >>> keep !== 0) refuse("presence padding bits set");
    }
    presence.seek(0);
}
