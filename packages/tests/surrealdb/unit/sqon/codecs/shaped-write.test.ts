/**
 * Writing blocks: deriving a shape from the rows which are about to be sent, writing them in
 * it, and reading them back. Every test here is a roundtrip, because a written block is only
 * correct if this SDK's own reader — which is a port of the server's — gets the rows back.
 */

import { describe, expect, test } from "bun:test";
import {
    BlockReader,
    DateTime,
    Decimal,
    Duration,
    deriveShape,
    F32,
    Kind,
    MAY_BE_ABSENT,
    RecordId,
    ShapedBlock,
    ShapedCodec,
    U8,
    U64,
    Uuid,
    writeBlock,
} from "@surrealdb/sqon";

const codec = new ShapedCodec();

/** The same codec with blocks turned off, for comparing against the plain CBOR array */
const never = new ShapedCodec({ blockThreshold: Number.POSITIVE_INFINITY });

/** Writes `rows` in the shape derived for them, reads them back, and returns both */
function roundtrip(rows: unknown[]): { shape: ReturnType<typeof deriveShape>; read: unknown[] } {
    const shape = deriveShape(rows);
    if (!shape) return { shape, read: [] };

    const block = writeBlock(shape, rows, (value) => codec.encode(value));
    const read = new BlockReader().read(new ShapedBlock(block), codec.dynamic);

    return { shape, read };
}

/** The column of `name` in the shape derived for `rows` */
function column(rows: unknown[], name: string) {
    return deriveShape(rows)?.columns.find((c) => c.name === name);
}

describe("a roundtrip through a derived shape", () => {
    test("every scalar kind comes back as it went in", () => {
        const rows = [
            {
                active: true,
                amount: new Decimal("1.25"),
                age: new U8(30),
                big: new U64(2n ** 63n + 1n),
                created: new DateTime([1700000000n, 123456789n]),
                id: new RecordId("person", 1),
                name: "ada",
                ratio: new F32(0.5),
                score: 1.5,
                session: new Uuid("01924b3c-f1a2-7e3d-a001-2f4b8c9d0e1f"),
                took: new Duration([90n, 1000n]),
                total: 42,
            },
        ];

        const { read } = roundtrip(rows);
        expect(read).toEqual(rows);
    });

    test("an int reads back as the CBOR path reads the same value, at every magnitude", () => {
        // The decoder reads the two halves of an int as plain numbers rather than building a
        // bigint for each, so the boundary where a number stops being exact is worth pinning:
        // 2^53 is still a number, and the first value past it is not
        const values = [
            0,
            -1,
            1,
            0xffffffff,
            -0xffffffff,
            0x1_0000_0000,
            Number.MAX_SAFE_INTEGER,
            -Number.MAX_SAFE_INTEGER,
            2 ** 53,
            -(2 ** 53),
            2n ** 53n + 1n,
            -(2n ** 53n) - 1n,
            2n ** 63n - 1n,
            -(2n ** 63n),
        ];

        const rows = values.map((v) => ({ v }));
        const { read } = roundtrip(rows);

        // Every value comes back exactly, and as the same kind of value it went in as
        expect(read).toEqual(rows);
        for (let i = 0; i < rows.length; i++) {
            expect(typeof (read[i] as { v: unknown }).v).toBe(typeof values[i]);
        }

        // And it agrees with what plain CBOR makes of the same rows. The one exception is
        // -(2^53)-1, which CBOR itself reads back as -(2^53): its decoder admits a negative
        // payload of exactly 2^53 to a number, where it no longer fits. That is a bug in
        // @surrealdb/cbor rather than in a block, so the block is not made to match it.
        const viaCbor = new ShapedCodec({ blockThreshold: Number.POSITIVE_INFINITY }).decode<
            { v: unknown }[]
        >(new ShapedCodec({ blockThreshold: Number.POSITIVE_INFINITY }).encode(rows));

        for (let i = 0; i < rows.length; i++) {
            if (values[i] === -(2n ** 53n) - 1n) continue;
            expect((read[i] as { v: unknown }).v).toEqual((viaCbor[i] as { v: unknown }).v);
        }
    });

    test("a string key, a uuid key and a numeric key all survive", () => {
        const rows = [
            { id: new RecordId("person", 1) },
            { id: new RecordId("person", "ada") },
            { id: new RecordId("person", new Uuid("01924b3c-f1a2-7e3d-a001-2f4b8c9d0e1f")) },
        ];

        expect(roundtrip(rows).read).toEqual(rows);
    });

    test("a key which only later rows hold is optional, not required", () => {
        // The first row has no `b`, so the column must allow being absent. Marking it required
        // because every row which holds it holds a value makes writing row 0 impossible.
        const rows = [{ a: 1 }, { a: 2, b: "x" }, { a: 3, b: "y" }];

        expect(column(rows, "b")?.flags).toBe(MAY_BE_ABSENT);
        expect(roundtrip(rows).read).toEqual(rows);
    });

    test("negative zero keeps its sign, as it does through CBOR", () => {
        const rows = Array.from({ length: 40 }, (_, i) => ({
            longKeyToMakeItWorthBlocking: `v${i}`,
            v: i === 0 ? -0 : -i,
        }));

        const read = roundtrip(rows).read as { v: number }[];
        expect(Object.is((read[0] as { v: number }).v, -0)).toBe(true);
    });

    test("an integral number too large for an int is a float, not a wrapped int", () => {
        // `Number.isInteger(1e300)` is true, but it is far outside an i64: writing it into a
        // fixed int slot wraps it to something else entirely
        const rows = [{ v: 1e300 }, { v: -1e300 }];

        expect(column(rows, "v")?.kind).toBe(Kind.Float);
        expect(roundtrip(rows).read).toEqual(rows);
    });

    test("a bigint past the int range is refused rather than wrapped", () => {
        const rows = Array.from({ length: 40 }, () => ({ v: 2n ** 70n }));

        // It lands in a dynamic column rather than an int slot which would wrap it, so the
        // request is refused by the CBOR codec exactly as one which never used a block is
        expect(column(rows, "v")?.kind).toBe(Kind.Dynamic);
        expect(() => codec.encode({ rows })).toThrow();
        expect(() => never.encode({ rows })).toThrow();
    });

    test("a record id whose key is an array or an object survives", () => {
        const rows = [
            { id: new RecordId("thing", [1, "two"]) },
            { id: new RecordId("thing", { a: 1 }) },
            { id: new RecordId("thing", 3) },
        ];

        expect(roundtrip(rows).read).toEqual(rows);
    });

    test("sibling names are ordered by their UTF-8 bytes, not their UTF-16 units", () => {
        // UTF-8 puts U+E000 (ee 80 80) before U+10000 (f0 90 80 80); UTF-16 puts the surrogate
        // pair of U+10000 first, which would order them the other way
        const rows = [{ "": 1, "\u{10000}": 2 }];
        const names = deriveShape(rows)?.columns.map((c) => c.name);

        expect(names).toEqual(["", "\u{10000}"]);
        expect(roundtrip(rows).read).toEqual(rows);
    });

    test("a key which is missing in some rows becomes an optional column", () => {
        const rows = [{ a: 1, b: "x" }, { a: 2 }, { a: 3, b: "z" }];

        expect(column(rows, "b")?.flags).toBe(0b01);
        expect(roundtrip(rows).read).toEqual(rows);
    });

    test("null and NONE are distinct states, and both survive", () => {
        const rows = [{ v: 1 }, { v: null }, { v: undefined }, {}];
        const { read } = roundtrip(rows);

        // Both bits, because NONE is the fourth state
        expect(column(rows, "v")?.flags).toBe(0b11);
        expect(read[0]).toEqual({ v: 1 });
        expect(read[1]).toEqual({ v: null });
        expect(Object.hasOwn(read[2] as object, "v")).toBe(true);
        expect((read[2] as { v: unknown }).v).toBe(undefined);
        expect(Object.hasOwn(read[3] as object, "v")).toBe(false);
    });

    test("a key whose rows disagree on a kind falls back to a dynamic column", () => {
        const rows = [{ v: 1 }, { v: "a string" }, { v: true }];

        expect(column(rows, "v")?.kind).toBe(Kind.Dynamic);
        expect(roundtrip(rows).read).toEqual(rows);
    });

    test("a nested object becomes a node of its own", () => {
        const rows = [{ meta: { tags: ["a"], depth: 2 }, n: 1 }];

        // Its keys are columns, so they are named once rather than in every row
        expect(column(rows, "meta")?.kind).toBe(Kind.Object);
        expect(roundtrip(rows).read).toEqual(rows);
    });

    test("an array of one element kind becomes a native array column", () => {
        const rows = [{ tags: ["a", "b"] }, { tags: [] }, { tags: ["c"] }];

        expect(column(rows, "tags")?.kind).toBe(Kind.Array);
        expect(column(rows, "tags")?.element).toBe(Kind.String);
        expect(roundtrip(rows).read).toEqual(rows);
    });

    test("an array of fixed elements round-trips through its own region", () => {
        const rows = [{ n: [1, 2, 3] }, { n: [] }];

        expect(column(rows, "n")?.element).toBe(Kind.Int);
        expect(roundtrip(rows).read).toEqual(rows);
    });

    test("a ragged array falls back to dynamic", () => {
        const rows = [{ v: [1, "two"] }, { v: [3] }];

        expect(column(rows, "v")?.kind).toBe(Kind.Dynamic);
        expect(roundtrip(rows).read).toEqual(rows);
    });

    test("columns are ordered by the bytes of their names", () => {
        const rows = [{ b: 1, A: 2, a: 3, "": 4, é: 5 }];
        const names = deriveShape(rows)?.columns.map((c) => c.name);

        // An empty name is not a column a shape may hold, so the whole shape is refused
        expect(names).toBeUndefined();

        const ok = [{ b: 1, A: 2, a: 3, é: 5 }];
        expect(deriveShape(ok)?.columns.map((c) => c.name)).toEqual(["A", "a", "b", "é"]);
        expect(roundtrip(ok).read).toEqual(ok);
    });

    test("many rows keep their order and their values", () => {
        const rows = Array.from({ length: 500 }, (_, i) => ({
            i,
            name: `n${i}`,
            ...(i % 3 === 0 ? { odd: true } : {}),
        }));

        expect(roundtrip(rows).read).toEqual(rows);
    });
});

describe("what cannot be a block", () => {
    test("an empty array", () => {
        expect(deriveShape([])).toBeUndefined();
    });

    test("an array which is not all objects", () => {
        expect(deriveShape([{ a: 1 }, 2])).toBeUndefined();
        expect(deriveShape(["a", "b"])).toBeUndefined();
    });

    test("rows with no keys at all", () => {
        expect(deriveShape([{}, {}])).toBeUndefined();
    });
});

describe("the codec decides when a block is worth sending", () => {
    /** A row whose keys are long and whose values are not, which is where a shape pays */
    const row = (i: number) => ({
        emailAddress: `person${i}@example.com`,
        familyName: `Family${i}`,
        givenName: `Given${i}`,
        isActive: i % 2 === 0,
        registeredAt: new DateTime([BigInt(1700000000 + i), 0n]),
    });

    test("a short array stays a CBOR array", () => {
        expect(codec.block(Array.from({ length: 8 }, (_, i) => row(i)))).toBeUndefined();
    });

    test("a long array becomes a block, and the request carries it", () => {
        const rows = Array.from({ length: 200 }, (_, i) => row(i));
        const request = { id: "1", method: "insert", params: ["person", rows] };

        const bytes = codec.encode(request);
        const back = codec.decode<{ params: [string, ShapedBlock] }>(bytes);

        expect(back.params[1]).toBeInstanceOf(ShapedBlock);
        expect(codec.rows(back.params[1], new BlockReader())).toEqual(rows);
    });

    test("a block is only sent when it is smaller than the array it replaces", () => {
        const rows = Array.from({ length: 200 }, (_, i) => row(i));

        const asBlock = codec.encode({ rows });
        const asArray = never.encode({ rows });

        expect(asBlock.length).toBeLessThan(asArray.length);
    });

    test("a short array is measured whole, so a block is never larger than the array", () => {
        // Up to the sample size the comparison is exact rather than extrapolated, which is
        // what makes the guarantee hold at these lengths
        for (const n of [32, 40, 48, 64]) {
            const rows = Array.from({ length: n }, (_, i) => ({
                k: `v${i}`,
                m: i % 7,
                flag: i % 2 === 0,
            }));

            const block = codec.block(rows);
            if (block) {
                expect(block.length).toBeLessThan(never.encode(rows).length);
            }
        }
    });

    test("rows a shape would make larger are left as a CBOR array", () => {
        // A small int costs one byte in CBOR and a whole i64 slot in a fixed region, so a
        // column of them is a loss the shape cannot pay back
        const rows = Array.from({ length: 200 }, (_, i) => ({ i, n: `n${i}` }));

        expect(codec.block(rows)).toBeUndefined();
        expect(codec.encode({ rows }).length).toBe(never.encode({ rows }).length);
        expect(codec.decode<{ rows: unknown[] }>(codec.encode({ rows }))).toEqual({ rows });
    });

    test("an array of values which share no shape is left as it is", () => {
        expect(codec.block(Array.from({ length: 200 }, (_, i) => i))).toBeUndefined();
    });

    test("a threshold of Infinity never writes a block", () => {
        const rows = Array.from({ length: 200 }, (_, i) => row(i));

        expect(never.block(rows)).toBeUndefined();
        expect(never.decode<{ rows: unknown[] }>(never.encode({ rows }))).toEqual({ rows });
    });
});
