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
    RecordId,
    ShapedBlock,
    ShapedCodec,
    U8,
    U64,
    Uuid,
    writeBlock,
} from "@surrealdb/sqon";

const codec = new ShapedCodec();

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

    test("a string key, a uuid key and a numeric key all survive", () => {
        const rows = [
            { id: new RecordId("person", 1) },
            { id: new RecordId("person", "ada") },
            { id: new RecordId("person", new Uuid("01924b3c-f1a2-7e3d-a001-2f4b8c9d0e1f")) },
        ];

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

    test("a nested object goes in a dynamic column and comes back whole", () => {
        const rows = [{ meta: { tags: ["a"], depth: 2 }, n: 1 }];

        expect(column(rows, "meta")?.kind).toBe(Kind.Dynamic);
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

    const never = new ShapedCodec({ blockThreshold: Number.POSITIVE_INFINITY });

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
