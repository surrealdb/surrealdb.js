import { ShapedFrameError } from "../../errors.ts";
import {
    MAX_COLUMNS,
    MAX_DEPTH,
    MAX_FIXED,
    MAY_BE_ABSENT,
    MAY_BE_NULL,
    NO_SLOT,
    presenceBytes,
    presenceWidth,
    ROOT_OBJECT,
    ROOT_VALUE,
} from "./constants.ts";
import { fixedWidth, hasOverflow, isElement, isVar, Kind, kindOf } from "./kinds.ts";
import { ByteReader, text } from "./reader.ts";

/** One column of a shape, as the SHAPE message lists it */
export interface Column {
    /** The key this column holds, non-empty UTF-8 */
    name: string;
    /** How the value is held */
    kind: Kind;
    /** For an `array`, the kind of every element; `undefined` for every other kind */
    element: Kind | undefined;
    /** `MAY_BE_ABSENT` and `MAY_BE_NULL` */
    flags: number;
    /** The first of the column's presence bits, or `NO_SLOT` for a required column */
    presence: number;
    /** The fixed offset of a fixed kind, the var slot of a variable kind, `NO_SLOT` for an object */
    slot: number;
    /** For a `record`, the table every value names, or empty when each value carries its own */
    table: string;
    /** For an `object`, how many columns its subtree holds */
    children: number;
    /**
     * For an `object`, the var slot of the node's remainder (`NO_SLOT` when it is closed); for a
     * kind with an overflow slot, that var slot; `NO_SLOT` for every other kind.
     */
    rest: number;
}

/**
 * A validated shape: the row layout its columns imply, and the columns themselves depth-first.
 *
 * A shape is checked once, when the SHAPE message which announces it is read, so that the rows
 * which follow can be read without re-checking their layout. Every slot a column names is known
 * to lie inside the region it belongs to, so reading a row only has to bound its own bytes.
 */
export class Shape {
    /** What each row is: `ROOT_OBJECT` or `ROOT_VALUE` */
    readonly root: number;
    /** The bits of a row's presence region */
    readonly presenceBits: number;
    /** The bytes of a row's fixed region */
    readonly fixedSize: number;
    /** The number of var slots in a row */
    readonly varCount: number;
    /** The root's remainder slot, `NO_SLOT` when closed; or a value root's value slot */
    readonly rootRest: number;
    /** The columns, depth-first */
    readonly columns: readonly Column[];

    /** For column `i`, the index past its subtree */
    readonly #ends: Uint32Array;
    /** The bytes of a row before its var region */
    readonly #header: number;
    /** The deepest nesting of object columns */
    readonly #depth: number;

    private constructor(
        root: number,
        presenceBits: number,
        fixedSize: number,
        varCount: number,
        rootRest: number,
        columns: Column[],
    ) {
        if (columns.length > MAX_COLUMNS) {
            throw new ShapedFrameError("too many columns");
        }
        if (fixedSize > MAX_FIXED) {
            throw new ShapedFrameError("a fixed region too large");
        }
        if (presenceBits > 2 * MAX_COLUMNS) {
            throw new ShapedFrameError("too many presence states");
        }
        if (varCount > 2 * MAX_COLUMNS + 1) {
            throw new ShapedFrameError("too many var slots");
        }

        if (root === ROOT_VALUE) {
            if (columns.length > 0 || rootRest >= varCount) {
                throw new ShapedFrameError("a value root with columns or no value slot");
            }
        } else if (rootRest !== NO_SLOT && rootRest >= varCount) {
            throw new ShapedFrameError("a remainder slot out of range");
        }

        this.root = root;
        this.presenceBits = presenceBits;
        this.fixedSize = fixedSize;
        this.varCount = varCount;
        this.rootRest = rootRest;
        this.columns = columns;

        this.#ends = new Uint32Array(columns.length);
        this.#depth = this.#checkNode(0, columns.length, 0);
        this.#header = presenceBytes(presenceBits) + fixedSize + 4 * varCount;
    }

    /**
     * Checks the columns of one node, which run from `start` to `end`, filling in where each
     * column's subtree stops. Returns how deeply objects nest below it.
     */
    #checkNode(start: number, end: number, depth: number): number {
        if (depth >= MAX_DEPTH) {
            throw new ShapedFrameError("objects nested too deep");
        }

        let deepest = 0;
        let at = start;
        let previous: string | undefined;

        while (at < end) {
            const column = this.columns[at] as Column;

            if (column.name === "") {
                throw new ShapedFrameError("an empty column name");
            }
            // Siblings are listed in the byte order of their UTF-8, which makes them distinct
            if (previous !== undefined && !(previous < column.name)) {
                throw new ShapedFrameError("column names out of order");
            }
            previous = column.name;

            if ((column.flags & ~(MAY_BE_ABSENT | MAY_BE_NULL)) !== 0) {
                throw new ShapedFrameError("unknown column flags");
            }

            const width = presenceWidth(column.flags);
            if (width === 0) {
                if (column.presence !== NO_SLOT) {
                    throw new ShapedFrameError("a presence index out of range");
                }
            } else if (column.presence + width > this.presenceBits) {
                throw new ShapedFrameError("a presence index out of range");
            }

            if (column.kind !== Kind.Record && column.table !== "") {
                throw new ShapedFrameError("a table on a column that is not a record");
            }

            if (column.kind === Kind.Array) {
                if (column.element === undefined || !isElement(column.element)) {
                    throw new ShapedFrameError("an array of no element kind");
                }
            } else if (column.element !== undefined) {
                throw new ShapedFrameError("an element kind on a column that is not an array");
            }

            if (column.kind !== Kind.Object && column.children !== 0) {
                throw new ShapedFrameError("children on a column that is not an object");
            }

            if (hasOverflow(column.kind)) {
                if (column.rest >= this.varCount) {
                    throw new ShapedFrameError("an overflow slot out of range");
                }
            } else if (column.kind !== Kind.Object && column.rest !== NO_SLOT) {
                throw new ShapedFrameError("a remainder on a column that is not an object");
            }

            const fixed = fixedWidth(column.kind);
            if (column.kind === Kind.Bit) {
                if (column.slot >= this.fixedSize * 8) {
                    throw new ShapedFrameError("a bit slot out of range");
                }
            } else if (fixed !== undefined) {
                if (column.slot + fixed > this.fixedSize) {
                    throw new ShapedFrameError("a fixed slot out of range");
                }
            } else if (isVar(column.kind)) {
                if (column.slot >= this.varCount) {
                    throw new ShapedFrameError("a var slot out of range");
                }
            } else if (column.slot !== NO_SLOT) {
                throw new ShapedFrameError("a slot on an object column");
            }

            const stop = at + 1 + column.children;
            if (stop > end) {
                throw new ShapedFrameError("children past their parent");
            }

            if (column.kind === Kind.Object) {
                if (column.rest !== NO_SLOT && column.rest >= this.varCount) {
                    throw new ShapedFrameError("a remainder slot out of range");
                }
                deepest = Math.max(deepest, 1 + this.#checkNode(at + 1, stop, depth + 1));
            }

            this.#ends[at] = stop;
            at = stop;
        }

        return deepest;
    }

    /** The bytes of a row before its var region */
    get headerLength(): number {
        return this.#header;
    }

    /** The bytes of a row's presence region */
    get presenceLength(): number {
        return presenceBytes(this.presenceBits);
    }

    /** Where a row's ends table starts */
    get endsAt(): number {
        return this.presenceLength + this.fixedSize;
    }

    /** The deepest nesting of object columns */
    get depth(): number {
        return this.#depth;
    }

    /** The indices of the child columns of `node`, or of the root when it is `undefined` */
    children(node: number | undefined): number[] {
        const at = node === undefined ? 0 : node + 1;
        const end = node === undefined ? this.columns.length : (this.#ends[node] as number);

        const out: number[] = [];
        for (let i = at; i < end; i = this.#ends[i] as number) out.push(i);
        return out;
    }

    /** The remainder slot of `node`, or of the root when it is `undefined` */
    rest(node: number | undefined): number {
        return node === undefined ? this.rootRest : (this.columns[node] as Column).rest;
    }

    /** Reads a shape from a SHAPE payload past its shape id, which it must fill exactly */
    static decode(bytes: Uint8Array): Shape {
        const r = new ByteReader(bytes);

        const root = r.u8();
        if (root !== ROOT_OBJECT && root !== ROOT_VALUE) {
            throw new ShapedFrameError("an unknown shape root");
        }

        const presenceBits = r.u32();
        const fixedSize = r.u32();
        const varCount = r.u32();
        const rootRest = r.u32();
        const count = r.u32();

        if (count > MAX_COLUMNS) {
            throw new ShapedFrameError("too many columns");
        }

        const columns: Column[] = [];
        for (let i = 0; i < count; i++) {
            const name = text(r.take(r.u16()), "a column name");
            const kind = kindOf(r.u8());
            const elementCode = r.u8();
            const element = elementCode === 0 ? undefined : kindOf(elementCode);
            const flags = r.u8();
            const presence = r.u32();
            const slot = r.u32();
            const table = text(r.take(r.u16()), "a table name");
            const children = r.u32();
            const rest = r.u32();

            columns.push({ name, kind, element, flags, presence, slot, table, children, rest });
        }

        if (!r.done) {
            throw new ShapedFrameError("bytes past a shape's columns");
        }

        return new Shape(root, presenceBits, fixedSize, varCount, rootRest, columns);
    }
}
