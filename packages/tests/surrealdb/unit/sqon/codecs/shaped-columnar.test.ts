/**
 * The columnar writer, against the row writer it replaces.
 *
 * The row writer stays in the package as the plain statement of what a block is: one row at a
 * time, one decision per value. The columnar one is the fast path, and the only thing which
 * makes it safe to prefer is that it writes the same bytes. So nearly every test here is a
 * differential one — build the same rows both ways and compare the bytes — rather than an
 * assertion about what the columnar writer happens to produce.
 */

import { describe, expect, test } from "bun:test";
import {
    BlockReader,
    Columns,
    DateTime,
    Decimal,
    Duration,
    deriveShape,
    F16,
    F32,
    I8,
    I16,
    I32,
    Kind,
    RecordId,
    ShapedBlock,
    ShapedCodec,
    U8,
    U16,
    U32,
    U64,
    Uuid,
    writeBlock,
} from "@surrealdb/sqon";

const codec = new ShapedCodec();
const encode = (value: unknown) => codec.encode(value);
const UUID = new Uuid("01924b3c-f1a2-7e3d-a001-2f4b8c9d0e1f");

/**
 * Writes `rows` both ways and asserts the bytes match, then returns what they decode to so a
 * test can also say what the rows should have been.
 */
function same(rows: unknown[]): unknown[] {
    const shape = deriveShape(rows);
    const columns = Columns.collect(rows);

    expect(columns).toBeDefined();
    expect(shape).toBeDefined();

    const viaRow = writeBlock(shape as never, rows, encode);
    const viaColumn = (columns as Columns).write(encode);

    expect(Buffer.from(viaColumn).equals(Buffer.from(viaRow))).toBe(true);
    return new BlockReader().read(new ShapedBlock(viaColumn), codec.dynamic);
}

/** The column of `name` in the shape these rows settle on */
function column(rows: unknown[], name: string) {
    return Columns.collect(rows)?.shape.columns.find((c) => c.name === name);
}

describe("the same bytes as the row writer", () => {
    test("every scalar kind", () => {
        const rows = [
            {
                b: true,
                by: new Uint8Array([1, 2, 3]),
                d: new DateTime([1700000000n, 5n]),
                dec: new Decimal("1.25"),
                du: new Duration([90n, 1000n]),
                f: 1.5,
                i: 42,
                r: new RecordId("person", 1),
                s: "hello",
                u: UUID,
            },
        ];

        // Bytes come back as an ArrayBuffer, which is what a CBOR byte string decodes to, so
        // the one key which does not compare equal to what went in is checked on its contents
        const read = same(rows)[0] as Record<string, unknown>;
        expect(new Uint8Array(read.by as ArrayBuffer)).toEqual(new Uint8Array([1, 2, 3]));
        expect({ ...read, by: undefined }).toEqual({ ...rows[0], by: undefined });
    });

    test("every sized number kind", () => {
        const rows = [
            {
                a: new I8(-8),
                b: new I16(-300),
                c: new I32(-70000),
                d: new U8(200),
                e: new U16(60000),
                f: new U32(4000000000),
                g: new U64(2n ** 63n + 1n),
                h: new F16(0.5),
                i: new F32(0.25),
            },
        ];

        expect(same(rows)).toEqual(rows);
    });

    test("a key missing from some rows", () => {
        expect(same([{ a: 1, b: "x" }, { a: 2 }, { a: 3, b: "z" }])).toEqual([
            { a: 1, b: "x" },
            { a: 2 },
            { a: 3, b: "z" },
        ]);
    });

    test("a key which only later rows hold", () => {
        expect(same([{ a: 1 }, { a: 2, b: "x" }])).toEqual([{ a: 1 }, { a: 2, b: "x" }]);
    });

    test("null, NONE and absent together", () => {
        const read = same([{ v: 1 }, { v: null }, { v: undefined }, {}]);

        expect(read[0]).toEqual({ v: 1 });
        expect(read[1]).toEqual({ v: null });
        expect(Object.hasOwn(read[2] as object, "v")).toBe(true);
        expect((read[2] as { v: unknown }).v).toBe(undefined);
        expect(Object.hasOwn(read[3] as object, "v")).toBe(false);
    });

    test("a column whose kinds disagree becomes dynamic", () => {
        const rows = [{ v: 1 }, { v: "s" }, { v: true }];

        expect(column(rows, "v")?.kind).toBe(Kind.Dynamic);
        expect(same(rows)).toEqual(rows);
    });

    test("ints and floats in one column do not widen into each other", () => {
        // A float column would lose an int past 2^53, so disagreement goes dynamic instead
        const rows = [{ v: 1 }, { v: 1.5 }];

        expect(column(rows, "v")?.kind).toBe(Kind.Dynamic);
        expect(same(rows)).toEqual(rows);
    });

    test("a nested object", () => {
        const rows = [{ meta: { a: 1, b: [1, 2] }, n: 1 }];

        expect(column(rows, "meta")?.kind).toBe(Kind.Dynamic);
        expect(same(rows)).toEqual(rows);
    });

    test("arrays of one element kind", () => {
        expect(same([{ t: ["a", "b"] }, { t: [] }, { t: ["c"] }])).toEqual([
            { t: ["a", "b"] },
            { t: [] },
            { t: ["c"] },
        ]);
        expect(same([{ n: [1, 2, 3] }, { n: [] }])).toEqual([{ n: [1, 2, 3] }, { n: [] }]);
    });

    test("a ragged array falls back to dynamic", () => {
        const rows = [{ v: [1, "two"] }, { v: [3] }];

        expect(column(rows, "v")?.kind).toBe(Kind.Dynamic);
        expect(same(rows)).toEqual(rows);
    });

    test("record keys of every kind", () => {
        const rows = [
            { id: new RecordId("t", 1) },
            { id: new RecordId("t", "s") },
            { id: new RecordId("t", UUID) },
            { id: new RecordId("t", [1, 2]) },
            { id: new RecordId("t", { a: 1 }) },
        ];

        expect(same(rows)).toEqual(rows);
    });

    test("records of one table hoist it, records of several carry it", () => {
        const one = [{ id: new RecordId("a", 1) }, { id: new RecordId("a", 2) }];
        const many = [{ id: new RecordId("a", 1) }, { id: new RecordId("b", 2) }];

        expect(column(one, "id")?.table).toBe("a");
        expect(column(many, "id")?.table).toBe("");
        expect(same(one)).toEqual(one);
        expect(same(many)).toEqual(many);
    });

    test("names outside the basic plane", () => {
        const rows = [{ "": 1, "\u{10000}": 2 }];

        expect(Columns.collect(rows)?.shape.columns.map((c) => c.name)).toEqual(["", "\u{10000}"]);
        expect(same(rows)).toEqual(rows);
    });

    test("names which collide with object internals", () => {
        const rows = [{ __proto__: 1, constructor: 2, hasOwnProperty: 3 } as never];
        expect(same(rows)).toEqual(rows);
    });

    test("negative zero and numbers past an int", () => {
        const rows = [{ v: -0 }, { v: -1 }];
        const read = same(rows) as { v: number }[];
        expect(Object.is((read[0] as { v: number }).v, -0)).toBe(true);

        expect(same([{ v: 1e300 }, { v: -1e300 }])).toEqual([{ v: 1e300 }, { v: -1e300 }]);
    });

    test("every int boundary", () => {
        const rows = [{ v: 0 }, { v: -1 }, { v: 0xffffffff }, { v: 2 ** 53 }, { v: -(2 ** 53) }];

        expect(same(rows)).toEqual(rows);
    });

    test("empty and unicode strings", () => {
        const rows = [{ s: "" }, { s: "x" }, { s: "héllo wörld 🎉" }, { s: "日本語" }];
        expect(same(rows)).toEqual(rows);
    });

    test("one row, and a row of one key", () => {
        expect(same([{ a: 1 }])).toEqual([{ a: 1 }]);
    });

    test("a wide row", () => {
        const rows = [Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`k${i}`, i]))];
        expect(same(rows)).toEqual(rows);
    });

    test("many rows keep their order", () => {
        const rows = Array.from({ length: 500 }, (_, i) => ({
            i,
            s: `v${i}`,
            ...(i % 3 === 0 ? { o: i } : {}),
        }));

        expect(same(rows)).toEqual(rows);
    });

    test("every row absent but the first", () => {
        expect(same([{ a: 1 }, {}, {}])).toEqual([{ a: 1 }, {}, {}]);
    });
});

describe("rows a block cannot carry", () => {
    test("an empty array", () => {
        expect(Columns.collect([])).toBeUndefined();
        expect(deriveShape([])).toBeUndefined();
    });

    test("entries which are not plain objects", () => {
        expect(Columns.collect([{ a: 1 }, 2])).toBeUndefined();
        expect(Columns.collect(["a"])).toBeUndefined();
        expect(Columns.collect([[1, 2]])).toBeUndefined();
        expect(Columns.collect([new RecordId("t", 1)])).toBeUndefined();
    });

    test("rows with no keys", () => {
        expect(Columns.collect([{}, {}])).toBeUndefined();
    });

    test("more columns than a shape may hold", () => {
        const wide = Object.fromEntries(Array.from({ length: 5000 }, (_, i) => [`k${i}`, i]));
        expect(Columns.collect([wide])).toBeUndefined();
    });
});

describe("the two writers agree on random rows", () => {
    /** A small deterministic generator, so a failure can be reproduced from its seed */
    function random(seed: number): () => number {
        let state = seed >>> 0;
        return () => {
            state = (state * 1664525 + 1013904223) >>> 0;
            return state / 0x1_0000_0000;
        };
    }

    const makers: ((r: () => number) => unknown)[] = [
        (r) => Math.floor(r() * 1000),
        (r) => r() * 1000,
        (r) => r() > 0.5,
        (r) => `s${Math.floor(r() * 1000)}`,
        (r) => new U8(Math.floor(r() * 256)),
        (r) => new DateTime([BigInt(Math.floor(r() * 1e9)), 0n]),
        (r) => new RecordId("t", Math.floor(r() * 100)),
        (r) => new Decimal(`${Math.floor(r() * 100)}.25`),
        (r) => [Math.floor(r() * 10), Math.floor(r() * 10)],
        (r) => ({ nested: Math.floor(r() * 10) }),
        () => null,
        () => undefined,
    ];

    test("200 random row sets produce identical bytes", () => {
        let checked = 0;

        for (let seed = 1; seed <= 200; seed++) {
            const r = random(seed);
            const keyCount = 1 + Math.floor(r() * 6);
            const keys = Array.from({ length: keyCount }, (_, k) => `k${k}`);
            const rowCount = 1 + Math.floor(r() * 12);

            const rows: Record<string, unknown>[] = [];
            for (let i = 0; i < rowCount; i++) {
                const row: Record<string, unknown> = {};
                for (const key of keys) {
                    // Sometimes a key is simply not there, which is its own state
                    if (r() < 0.25) continue;
                    const maker = makers[Math.floor(r() * makers.length)] as (
                        g: () => number,
                    ) => unknown;
                    row[key] = maker(r);
                }
                rows.push(row);
            }

            const shape = deriveShape(rows);
            const columns = Columns.collect(rows);
            if (!shape || !columns) continue;

            const viaRow = writeBlock(shape, rows, encode);
            const viaColumn = columns.write(encode);

            if (!Buffer.from(viaColumn).equals(Buffer.from(viaRow))) {
                throw new Error(`seed ${seed}: the writers disagree`);
            }

            // And both are readable, giving back what went in
            const read = new BlockReader().read(new ShapedBlock(viaColumn), codec.dynamic);
            expect(read).toEqual(rows);
            checked++;
        }

        // The generator must actually be producing blocks, or this proves nothing
        expect(checked).toBeGreaterThan(150);
    });
});

describe("the codec uses it", () => {
    const row = (i: number) => ({
        emailAddress: `person${i}@example.com`,
        familyName: `Family${i}`,
        givenName: `Given${i}`,
        isActive: i % 2 === 0,
        registeredAt: new DateTime([BigInt(1700000000 + i), 0n]),
    });

    test("a request carries the same bytes it did before", () => {
        const rows = Array.from({ length: 200 }, (_, i) => row(i));

        const block = codec.block(rows);
        expect(block).toBeDefined();

        // The block the codec sends is the one the row writer would have produced
        const shape = deriveShape(rows) as never;
        const viaRow = writeBlock(shape, rows, encode);
        expect(Buffer.from(block as Uint8Array).subarray(7)).toEqual(Buffer.from(viaRow));
    });

    test("and the rows survive a round trip through it", () => {
        const rows = Array.from({ length: 200 }, (_, i) => row(i));
        const back = codec.decode<{ rows: ShapedBlock }>(codec.encode({ rows }));

        expect(back.rows).toBeInstanceOf(ShapedBlock);
        expect(codec.rows(back.rows, new BlockReader())).toEqual(rows);
    });
});
