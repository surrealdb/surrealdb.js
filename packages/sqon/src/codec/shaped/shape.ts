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
import { ByteReader, ByteWriter, refuse } from "./reader.ts";

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
            refuse("too many columns");
        }
        if (fixedSize > MAX_FIXED) {
            refuse("a fixed region too large");
        }
        if (presenceBits > 2 * MAX_COLUMNS) {
            refuse("too many presence states");
        }
        if (varCount > 2 * MAX_COLUMNS + 1) {
            refuse("too many var slots");
        }

        if (root === ROOT_VALUE) {
            if (columns.length > 0 || rootRest >= varCount) {
                refuse("a value root with columns or no value slot");
            }
        } else if (rootRest !== NO_SLOT && rootRest >= varCount) {
            refuse("a remainder slot out of range");
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
        if (depth >= MAX_DEPTH) refuse("objects nested too deep");

        let deepest = 0;
        let at = start;
        let previous: string | undefined;

        while (at < end) {
            const column = this.columns[at] as Column;

            this.#checkName(column, previous);
            this.#checkFlags(column);
            this.#checkKind(column);
            this.#checkSlot(column);
            previous = column.name;

            const stop = at + 1 + column.children;
            if (stop > end) refuse("children past their parent");

            if (column.kind === Kind.Object) {
                if (column.rest !== NO_SLOT && column.rest >= this.varCount) {
                    refuse("a remainder slot out of range");
                }
                deepest = Math.max(deepest, 1 + this.#checkNode(at + 1, stop, depth + 1));
            }

            this.#ends[at] = stop;
            at = stop;
        }

        return deepest;
    }

    /** A name is non-empty, and siblings are in the byte order of their UTF-8, so all distinct */
    #checkName(column: Column, previous: string | undefined): void {
        if (column.name === "") refuse("an empty column name");
        if (previous !== undefined && !(previous < column.name)) {
            refuse("column names out of order");
        }
    }

    /** The flags are the two the format has, and the presence bits they imply are in range */
    #checkFlags(column: Column): void {
        if ((column.flags & ~(MAY_BE_ABSENT | MAY_BE_NULL)) !== 0) refuse("unknown column flags");

        const width = presenceWidth(column.flags);
        const inRange =
            width === 0
                ? column.presence === NO_SLOT
                : column.presence + width <= this.presenceBits;

        if (!inRange) refuse("a presence index out of range");
    }

    /** What a column carries beyond its kind belongs to that kind: a table, an element, children */
    #checkKind(column: Column): void {
        if (column.kind !== Kind.Record && column.table !== "") {
            refuse("a table on a column that is not a record");
        }

        if (column.kind === Kind.Array) {
            if (column.element === undefined || !isElement(column.element)) {
                refuse("an array of no element kind");
            }
        } else if (column.element !== undefined) {
            refuse("an element kind on a column that is not an array");
        }

        if (column.kind !== Kind.Object && column.children !== 0) {
            refuse("children on a column that is not an object");
        }

        if (hasOverflow(column.kind)) {
            if (column.rest >= this.varCount) refuse("an overflow slot out of range");
        } else if (column.kind !== Kind.Object && column.rest !== NO_SLOT) {
            refuse("a remainder on a column that is not an object");
        }
    }

    /**
     * The column's slot lies inside the region its kind is held in, so reading a row only has
     * to bound its own bytes rather than re-check the layout for every row.
     */
    #checkSlot(column: Column): void {
        const fixed = fixedWidth(column.kind);

        if (column.kind === Kind.Bit) {
            if (column.slot >= this.fixedSize * 8) refuse("a bit slot out of range");
        } else if (fixed !== undefined) {
            if (column.slot + fixed > this.fixedSize) refuse("a fixed slot out of range");
        } else if (isVar(column.kind)) {
            if (column.slot >= this.varCount) refuse("a var slot out of range");
        } else if (column.slot !== NO_SLOT) {
            refuse("a slot on an object column");
        }
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

    /**
     * A shape built from its parts, checked by the same rules a shape read off the wire is.
     * A shape derived from values to send goes through here, so a shape this SDK writes can
     * never be one it would refuse to read.
     */
    static of(def: {
        root?: number;
        presenceBits?: number;
        fixedSize?: number;
        varCount?: number;
        rootRest?: number;
        columns?: Column[];
    }): Shape {
        return new Shape(
            def.root ?? ROOT_OBJECT,
            def.presenceBits ?? 0,
            def.fixedSize ?? 0,
            def.varCount ?? 0,
            def.rootRest ?? NO_SLOT,
            def.columns ?? [],
        );
    }

    /** The SHAPE payload of this shape, past its shape id */
    encode(): Uint8Array {
        const out = new ByteWriter()
            .u8(this.root)
            .u32(this.presenceBits)
            .u32(this.fixedSize)
            .u32(this.varCount)
            .u32(this.rootRest)
            .u32(this.columns.length);

        for (const column of this.columns) {
            out.u16Text(column.name)
                .u8(column.kind)
                .u8(column.element ?? 0)
                .u8(column.flags)
                .u32(column.presence)
                .u32(column.slot)
                .u16Text(column.table)
                .u32(column.children)
                .u32(column.rest);
        }

        return out.bytes;
    }

    /** Reads a shape from a SHAPE payload past its shape id, which it must fill exactly */
    static decode(bytes: Uint8Array): Shape {
        const r = new ByteReader(bytes);

        const root = r.u8();
        if (root !== ROOT_OBJECT && root !== ROOT_VALUE) {
            refuse("an unknown shape root");
        }

        const presenceBits = r.u32();
        const fixedSize = r.u32();
        const varCount = r.u32();
        const rootRest = r.u32();
        const count = r.u32();

        if (count > MAX_COLUMNS) {
            refuse("too many columns");
        }

        const columns: Column[] = [];
        for (let i = 0; i < count; i++) {
            const name = r.text(r.u16(), "a column name");
            const kind = kindOf(r.u8());
            const elementCode = r.u8();
            const element = elementCode === 0 ? undefined : kindOf(elementCode);
            const flags = r.u8();
            const presence = r.u32();
            const slot = r.u32();
            const table = r.text(r.u16(), "a table name");
            const children = r.u32();
            const rest = r.u32();

            columns.push({ name, kind, element, flags, presence, slot, table, children, rest });
        }

        if (!r.done) {
            refuse("bytes past a shape's columns");
        }

        return new Shape(root, presenceBits, fixedSize, varCount, rootRest, columns);
    }
}
