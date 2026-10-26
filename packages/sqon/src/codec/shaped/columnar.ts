import type { DateTime } from "../../value/datetime.ts";
import type { Duration } from "../../value/duration.ts";
import type { RecordId } from "../../value/record-id.ts";
import type { SizedNumber } from "../../value/sized.ts";
import { Uuid } from "../../value/uuid.ts";
import {
    MAX_COLUMNS,
    MAX_DEPTH,
    MAY_BE_ABSENT,
    MAY_BE_NULL,
    MESSAGE_BATCH,
    MESSAGE_SHAPE,
    NO_SLOT,
    presenceBytes,
    presenceWidth,
    STATE_ABSENT,
    STATE_NONE,
    STATE_NULL,
    STATE_VALUE,
    VERSION,
} from "./constants.ts";
import { fixedWidth, Kind } from "./kinds.ts";
import { elementOf, isPlainObject, kindOf, MIXED } from "./kinds-of.ts";
import { ownKeys } from "./object.ts";
import { ByteWriter, byUtf8, refuse } from "./reader.ts";
import { type Column, Shape } from "./shape.ts";
import { type DynamicEncoder, recordBytes, varBytes, writeFixed } from "./write.ts";

/**
 * Reading a batch of rows column by column rather than row by row.
 *
 * A block is row-major on the wire — a row is `presence | fixed | ends | var` laid end to end —
 * but the work of building one is per column, because a column's kind is the one thing every
 * value in it shares. Writing a column at a time means deciding what a value is **once per
 * column** instead of once per value: the kind is read out of the shape, and then a loop runs
 * over values which are all of it. Writing a row at a time has to ask again for every field.
 *
 * What makes that possible for a row-major format is that a row's header — its presence region,
 * its fixed region and its ends table — is the same width for every row of a shape. So the
 * headers go into one buffer at `row * stride`, written down the columns, and only the variable
 * region has to be threaded back in at the end, which is byte copying with nothing left to
 * decide.
 */

/** What the rows held in one column, and where that column ends up in the shape */
interface Accumulated {
    name: string;
    /** The one kind every value had, or {@link MIXED} when they disagreed */
    kind: number;
    /** Whether any value at all has been seen, so the first one can set the kind */
    seenAny: boolean;
    /** For an array, the one element kind every one had; `MIXED` or `undefined` otherwise */
    element: number | undefined;
    /** The table every record named: `undefined` until one is seen, `null` once two differ */
    table: string | null | undefined;
    absent: boolean;
    null: boolean;
    none: boolean;
    /** What each row held: absent, a value, `NULL`, or `NONE` */
    states: Uint8Array;
    /** The values themselves, read once and kept until the column is written */
    values: unknown[];
    /** For an object, the keys beneath it, which become columns of their own */
    children: Accumulated[];
    /** Those same children by name, for finding one while the rows are read */
    byName: Record<string, Accumulated>;
}

/** A node being filled in: the root, or one object column's subtree */
interface Node {
    children: Accumulated[];
    byName: Record<string, Accumulated>;
}

/** How many columns a shape may hold, counted over every depth */
interface Budget {
    left: number;
}

/**
 * A batch of rows read into per-column form, and the shape they share.
 *
 * {@link collect} reads every row once. The shape is settled from what that saw, so it can be
 * measured before anything is written, and {@link write} then builds the block from the values
 * already in hand.
 */
export class Columns {
    readonly shape: Shape;
    readonly #columns: Accumulated[];
    readonly #rows: number;

    private constructor(shape: Shape, columns: Accumulated[], rows: number) {
        this.shape = shape;
        this.#columns = columns;
        this.#rows = rows;
    }

    /**
     * Reads `rows` into columns and settles their shape, or gives up when they are not rows a
     * block can carry: an empty array, entries which are not plain objects, or no keys at all.
     */
    static collect(rows: readonly unknown[]): Columns | undefined {
        if (rows.length === 0) return undefined;

        const n = rows.length;
        // A null prototype so that a column called `__proto__` or `constructor` is just a key
        const root: Node = { children: [], byName: Object.create(null) };
        const budget: Budget = { left: MAX_COLUMNS };

        for (let at = 0; at < n; at++) {
            const row = rows[at];
            if (!isPlainObject(row)) return undefined;
            if (!observeNode(root, row, at, n, 0, budget)) return undefined;
        }

        if (root.children.length === 0) return undefined;

        const order: Accumulated[] = [];
        const columns: Column[] = [];
        const layout = { fixedSize: 0, varCount: 0, presenceBits: 0 };

        if (!flatten(root, order, columns, layout)) return undefined;

        try {
            const shape = Shape.of({
                presenceBits: layout.presenceBits,
                fixedSize: layout.fixedSize,
                varCount: layout.varCount,
                columns,
            });
            return new Columns(shape, order, n);
        } catch {
            // A shape this SDK would refuse to read is one it must not write
            return undefined;
        }
    }

    /** The block these rows make: a SHAPE message announcing their shape, then one BATCH */
    write(dynamic: DynamicEncoder): Uint8Array {
        const shape = this.shape;
        const n = this.#rows;

        const presenceLen = presenceBytes(shape.presenceBits);
        const endsAt = presenceLen + shape.fixedSize;
        const stride = shape.headerLength;

        // Every row's header, at a fixed stride, so a column is a walk down one offset
        const headers = new Uint8Array(n * stride);
        const view = new DataView(headers.buffer);

        // Each variable column's slices, kept until the rows are threaded together
        const slices: (Uint8Array | undefined)[][] = new Array(shape.varCount);

        const columns = shape.columns;
        for (let c = 0; c < columns.length; c++) {
            const column = columns[c] as Column;
            const accumulated = this.#columns[c] as Accumulated;

            writePresence(headers, stride, column, accumulated.states, n);

            // An object column holds no value of its own: saying whether the node is there is
            // all there is to write, and its children are columns in their own right
            if (column.kind === Kind.Object) continue;

            if (fixedWidth(column.kind) === undefined) {
                slices[column.slot] = writeVar(column, accumulated, n, dynamic);
            } else {
                writeColumn(view, headers, stride, presenceLen, column, accumulated, n);
            }
        }

        // The ends table, and with it how long the whole batch is
        let total = 0;
        for (let i = 0; i < n; i++) {
            let end = 0;
            for (let v = 0; v < shape.varCount; v++) {
                const slice = (slices[v] as (Uint8Array | undefined)[])[i];
                if (slice !== undefined) end += slice.length;
                view.setUint32(i * stride + endsAt + 4 * v, end, true);
            }
            total += stride + end;
        }

        return frame(shape, headers, slices, stride, n, total);
    }
}

/**
 * Folds one object's keys into `node`, which is the root or an object column's subtree.
 *
 * Returns false when the rows cannot be shaped: too many columns over every depth, or objects
 * nested deeper than a shape may hold.
 */
function observeNode(
    node: Node,
    object: Record<string, unknown>,
    at: number,
    rows: number,
    depth: number,
    budget: Budget,
): boolean {
    if (depth >= MAX_DEPTH) return false;

    for (const name of ownKeys(object)) {
        let column = node.byName[name];

        if (column === undefined) {
            if (budget.left === 0) return false;
            budget.left -= 1;

            column = {
                name,
                kind: MIXED,
                seenAny: false,
                element: undefined,
                table: undefined,
                // A key first seen after row 0 was missing from every row before it
                absent: at > 0,
                null: false,
                none: false,
                states: new Uint8Array(rows),
                values: new Array(rows),
                children: [],
                byName: Object.create(null),
            };
            node.byName[name] = column;
            node.children.push(column);
        }

        const value = object[name];
        observe(column, at, value);

        // A plain object is a node of its own: its keys are columns under this one, so they
        // are named in the shape rather than in every row
        if (column.states[at] === STATE_VALUE && column.kind === Kind.Object) {
            if (
                !observeNode(column, value as Record<string, unknown>, at, rows, depth + 1, budget)
            ) {
                return false;
            }
        }
    }

    // A key this node has held before and this object does not is absent in it. A node which
    // is not present at all leaves its own children alone: the reader never reaches them.
    for (let i = 0; i < node.children.length; i++) {
        const column = node.children[i] as Accumulated;
        if (column.states[at] === STATE_ABSENT && !Object.hasOwn(object, column.name)) {
            column.absent = true;
        }
    }

    return true;
}

/** Folds one value into what its column has seen, and keeps it for the write */
function observe(column: Accumulated, at: number, value: unknown): void {
    if (value === null) {
        column.states[at] = STATE_NULL;
        column.null = true;
        return;
    }
    if (value === undefined) {
        column.states[at] = STATE_NONE;
        column.none = true;
        return;
    }

    column.states[at] = STATE_VALUE;
    column.values[at] = value;

    const kind = kindOf(value);

    // The first value sets the column's kind; any later one which disagrees makes it MIXED,
    // and a mixed column stays mixed however many values follow
    if (!column.seenAny) {
        column.kind = kind;
        column.seenAny = true;
    } else if (column.kind !== kind) {
        column.kind = MIXED;
    }

    if (kind === Kind.Array) {
        const element = elementOf(value as unknown[]);
        if (element === "mixed") column.element = MIXED;
        else if (element !== "empty" && column.element !== MIXED) {
            column.element =
                column.element === undefined || column.element === element ? element : MIXED;
        }
    }

    if (kind === Kind.Record) {
        const table = (value as RecordId).table.name;
        column.table = column.table === undefined ? table : column.table === table ? table : null;
    }
}

/** Where a shape's regions have been filled up to while its columns are laid out */
interface Layout {
    fixedSize: number;
    varCount: number;
    presenceBits: number;
}

/**
 * Lays one node's columns out, depth first: a column, then the subtree of an object column.
 *
 * The accumulators come out in the same order as the columns, so the writer can pair them by
 * index. Returns false when a column's kind could not be settled into a shape.
 */
function flatten(node: Node, order: Accumulated[], columns: Column[], layout: Layout): boolean {
    // Siblings are listed in the byte order of their UTF-8, which a shape requires
    node.children.sort(byName_);

    for (const accumulated of node.children) {
        const kind = kindFor(accumulated);

        // A key whose value is ever NONE needs both bits, since NONE is the fourth state
        const flags =
            (accumulated.absent || accumulated.none ? MAY_BE_ABSENT : 0) |
            (accumulated.null || accumulated.none ? MAY_BE_NULL : 0);

        const width = presenceWidth(flags);
        const presence = width === 0 ? NO_SLOT : layout.presenceBits;
        layout.presenceBits += width;

        let slot: number;
        const fixed = fixedWidth(kind);
        if (kind === Kind.Object) {
            // An object column holds no value of its own; its children are its value
            slot = NO_SLOT;
        } else if (fixed !== undefined) {
            slot = layout.fixedSize;
            layout.fixedSize += fixed;
        } else {
            slot = layout.varCount;
            layout.varCount += 1;
        }

        const column: Column = {
            name: accumulated.name,
            kind,
            element:
                kind === Kind.Array
                    ? ((accumulated.element === MIXED ? undefined : accumulated.element) as Kind)
                    : undefined,
            flags,
            presence,
            slot,
            table:
                kind === Kind.Record && typeof accumulated.table === "string"
                    ? accumulated.table
                    : "",
            children: 0,
            // Every key a node held became a column of its own, so nothing is left over and
            // the node is closed
            rest: NO_SLOT,
        };

        const at = columns.length;
        columns.push(column);
        order.push(accumulated);

        if (kind === Kind.Object) {
            if (!flatten(accumulated, order, columns, layout)) return false;
            // How many columns the subtree took, which is what a reader skips it by
            column.children = columns.length - at - 1;
        }
    }

    return true;
}

/** Orders two columns by the bytes of their names, which is the order a shape lists them in */
function byName_(a: Accumulated, b: Accumulated): number {
    return byUtf8(a.name, b.name);
}

/** The one kind a column holds, or `dynamic` when its rows did not settle on one */
function kindFor(accumulated: Accumulated): Kind {
    if (accumulated.kind === MIXED) return Kind.Dynamic;

    const kind = accumulated.kind as Kind;

    // An array whose element kind the rows did not agree on is one CBOR item instead
    if (
        kind === Kind.Array &&
        (accumulated.element === MIXED || accumulated.element === undefined)
    ) {
        return Kind.Dynamic;
    }
    return kind;
}

/** Sets each row's presence bits for one column, which are the same two bits every time */
function writePresence(
    headers: Uint8Array,
    stride: number,
    column: Column,
    states: Uint8Array,
    n: number,
): void {
    const width = presenceWidth(column.flags);
    if (width === 0) return;

    const low = column.presence;
    const lowByte = low >>> 3;
    const lowMask = 1 << (low % 8);

    if (width === 1) {
        // One bit, set for a value and clear for whichever of the two the flag allows
        for (let i = 0; i < n; i++) {
            if (states[i] === STATE_VALUE) {
                const at = i * stride + lowByte;
                headers[at] = (headers[at] as number) | lowMask;
            }
        }
        return;
    }

    const high = low + 1;
    const highByte = high >>> 3;
    const highMask = 1 << (high % 8);

    for (let i = 0; i < n; i++) {
        const state = states[i] as number;
        if (state & 0b01) {
            const at = i * stride + lowByte;
            headers[at] = (headers[at] as number) | lowMask;
        }
        if (state & 0b10) {
            const at = i * stride + highByte;
            headers[at] = (headers[at] as number) | highMask;
        }
    }
}

/**
 * Writes one fixed column into every row's header.
 *
 * The kind is read once, before the loop, so each case below runs over values which are all of
 * that kind. A row writer asks the same question again for every field of every row.
 */
function writeColumn(
    view: DataView,
    headers: Uint8Array,
    stride: number,
    presenceLen: number,
    column: Column,
    accumulated: Accumulated,
    n: number,
): void {
    const states = accumulated.states;
    const values = accumulated.values;
    const base = presenceLen + column.slot;

    switch (column.kind) {
        case Kind.Bool:
            for (let i = 0; i < n; i++) {
                if (states[i] === STATE_VALUE) headers[i * stride + base] = values[i] ? 1 : 0;
            }
            return;
        case Kind.Int:
            for (let i = 0; i < n; i++) {
                if (states[i] === STATE_VALUE) {
                    view.setBigInt64(i * stride + base, BigInt(values[i] as number), true);
                }
            }
            return;
        case Kind.Float:
            for (let i = 0; i < n; i++) {
                if (states[i] === STATE_VALUE) {
                    view.setFloat64(i * stride + base, values[i] as number, true);
                }
            }
            return;
        case Kind.Datetime:
            for (let i = 0; i < n; i++) {
                if (states[i] !== STATE_VALUE) continue;
                const [secs, nanos] = (values[i] as DateTime).toCompact();
                view.setBigInt64(i * stride + base, secs, true);
                view.setUint32(i * stride + base + 8, Number(nanos), true);
            }
            return;
        case Kind.Duration:
            for (let i = 0; i < n; i++) {
                if (states[i] !== STATE_VALUE) continue;
                const [secs = 0n, nanos = 0n] = (values[i] as Duration).toCompact();
                view.setBigUint64(i * stride + base, BigInt(secs), true);
                view.setUint32(i * stride + base + 8, Number(nanos), true);
            }
            return;
        case Kind.Uuid:
            for (let i = 0; i < n; i++) {
                if (states[i] === STATE_VALUE) {
                    headers.set(new Uuid(values[i] as Uuid).toUint8Array(), i * stride + base);
                }
            }
            return;
        case Kind.U8:
            for (let i = 0; i < n; i++) {
                if (states[i] === STATE_VALUE) {
                    headers[i * stride + base] = Number((values[i] as SizedNumber).value);
                }
            }
            return;
        case Kind.I8:
            for (let i = 0; i < n; i++) {
                if (states[i] === STATE_VALUE) {
                    view.setInt8(i * stride + base, Number((values[i] as SizedNumber).value));
                }
            }
            return;
        case Kind.U16:
            for (let i = 0; i < n; i++) {
                if (states[i] === STATE_VALUE) {
                    view.setUint16(
                        i * stride + base,
                        Number((values[i] as SizedNumber).value),
                        true,
                    );
                }
            }
            return;
        case Kind.I16:
            for (let i = 0; i < n; i++) {
                if (states[i] === STATE_VALUE) {
                    view.setInt16(
                        i * stride + base,
                        Number((values[i] as SizedNumber).value),
                        true,
                    );
                }
            }
            return;
        case Kind.U32:
            for (let i = 0; i < n; i++) {
                if (states[i] === STATE_VALUE) {
                    view.setUint32(
                        i * stride + base,
                        Number((values[i] as SizedNumber).value),
                        true,
                    );
                }
            }
            return;
        case Kind.I32:
            for (let i = 0; i < n; i++) {
                if (states[i] === STATE_VALUE) {
                    view.setInt32(
                        i * stride + base,
                        Number((values[i] as SizedNumber).value),
                        true,
                    );
                }
            }
            return;
        case Kind.U64:
            for (let i = 0; i < n; i++) {
                if (states[i] === STATE_VALUE) {
                    view.setBigUint64(
                        i * stride + base,
                        BigInt((values[i] as SizedNumber).value),
                        true,
                    );
                }
            }
            return;
        case Kind.F32:
            for (let i = 0; i < n; i++) {
                if (states[i] === STATE_VALUE) {
                    view.setFloat32(
                        i * stride + base,
                        Number((values[i] as SizedNumber).value),
                        true,
                    );
                }
            }
            return;
        default:
            // What is left — `f16`, and the escaping datetime and duration a derived shape
            // never produces — goes through the shared writer, still one dispatch per column
            for (let i = 0; i < n; i++) {
                if (states[i] === STATE_VALUE) {
                    writeFixed(view, headers, i * stride + base, column.kind, values[i]);
                }
            }
            return;
    }
}

/** Converts one variable column's values into the slices the rows will carry */
function writeVar(
    column: Column,
    accumulated: Accumulated,
    n: number,
    dynamic: DynamicEncoder,
): (Uint8Array | undefined)[] {
    const states = accumulated.states;
    const values = accumulated.values;
    const out: (Uint8Array | undefined)[] = new Array(n);

    switch (column.kind) {
        case Kind.String:
            for (let i = 0; i < n; i++) {
                if (states[i] === STATE_VALUE) out[i] = UTF8.encode(values[i] as string);
            }
            return out;
        case Kind.Dynamic:
            for (let i = 0; i < n; i++) {
                if (states[i] === STATE_VALUE) out[i] = dynamic(values[i]);
            }
            return out;
        case Kind.Record:
            for (let i = 0; i < n; i++) {
                if (states[i] === STATE_VALUE) {
                    out[i] = recordBytes(values[i] as RecordId, column.table, dynamic);
                }
            }
            return out;
        default:
            for (let i = 0; i < n; i++) {
                if (states[i] === STATE_VALUE) {
                    out[i] = varBytes(column, values[i], dynamic);
                }
            }
            return out;
    }
}

/** Threads the headers back together with their variable regions, and frames the block */
function frame(
    shape: Shape,
    headers: Uint8Array,
    slices: (Uint8Array | undefined)[][],
    stride: number,
    n: number,
    total: number,
): Uint8Array {
    const payload = new Uint8Array(total);
    const varCount = shape.varCount;

    let at = 0;
    for (let i = 0; i < n; i++) {
        payload.set(headers.subarray(i * stride, i * stride + stride), at);
        at += stride;

        for (let v = 0; v < varCount; v++) {
            const slice = (slices[v] as (Uint8Array | undefined)[])[i];
            if (slice !== undefined && slice.length !== 0) {
                payload.set(slice, at);
                at += slice.length;
            }
        }
    }

    if (at !== total) refuse("a batch which did not fill its own bytes");

    const announced = shape.encode();

    // The block's size is settled: a version byte, a SHAPE message of a type, a length, an id
    // and the shape, and a BATCH of a type, a length, an id, a count and the rows
    const out = new ByteWriter(1 + 9 + announced.length + 13 + payload.length).u8(VERSION);

    out.u8(MESSAGE_SHAPE)
        .u32(announced.length + 4)
        .u32(1)
        .raw(announced);

    out.u8(MESSAGE_BATCH)
        .u32(payload.length + 8)
        .u32(1)
        .u32(n)
        .raw(payload);

    return out.bytes;
}

const UTF8 = new TextEncoder();
