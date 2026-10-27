/**
 * The shaped block decoder: the kinds a column holds, how presence says a key is absent, `NULL`
 * or `NONE`, how shape ids live in a scope across blocks, and what the decoder refuses.
 */

import { describe, expect, test } from "bun:test";
import {
    BlockReader,
    CborCodec,
    DateTime,
    Decimal,
    Duration,
    F32,
    I16,
    RecordId,
    ShapedBlock,
    ShapedCodec,
    ShapedFrameError,
    SqonError,
    U8,
    U64,
    Uuid,
} from "@surrealdb/sqon";
import {
    batchMessage,
    block,
    blockContents,
    dynamic,
    Fixed,
    fixedArray,
    Kind,
    MAY_BE_ABSENT,
    MAY_BE_NULL,
    NO_SLOT,
    recordNumber,
    recordString,
    row,
    shapeMessage,
    utf8,
    varArray,
} from "./__helpers__/shaped.ts";

const codec = new ShapedCodec();

/** The rows of a block built from `messages`, read in a fresh scope */
function rows(...messages: Uint8Array[]): unknown[] {
    const scope = new BlockReader();
    return scope.read(new ShapedBlock(blockContents(...messages)), codec.dynamic);
}

describe("the kinds a column holds", () => {
    test("every fixed kind reads back as the value it holds", () => {
        const fixed = new Fixed(8 + 8 + 1 + 1 + 2 + 4 + 8 + 12 + 12 + 16)
            .i64(0, -42n)
            .f64(8, 1.5)
            .u8(16, 1)
            .u8(17, 200)
            .i16(18, -300)
            .f32(20, 0.5)
            .u64(24, 2n ** 63n + 7n)
            .i64(32, 1700000000n)
            .u32(40, 500)
            .u64(44, 90n)
            .u32(52, 1000)
            .raw(56, new Uint8Array(16).fill(0xab));

        const [value] = rows(
            shapeMessage(1, {
                fixedSize: fixed.bytes.length,
                columns: [
                    { name: "b", kind: Kind.Bool, slot: 16 },
                    { name: "dt", kind: Kind.Datetime, slot: 32 },
                    { name: "du", kind: Kind.Duration, slot: 44 },
                    { name: "f", kind: Kind.Float, slot: 8 },
                    { name: "f32", kind: Kind.F32, slot: 20 },
                    { name: "i", kind: Kind.Int, slot: 0 },
                    { name: "i16", kind: Kind.I16, slot: 18 },
                    { name: "u64", kind: Kind.U64, slot: 24 },
                    { name: "u8", kind: Kind.U8, slot: 17 },
                    { name: "uu", kind: Kind.Uuid, slot: 56 },
                ],
            }),
            batchMessage(1, [row({ fixed: fixed.bytes })]),
        );

        expect(value).toEqual({
            b: true,
            dt: new DateTime([1700000000n, 500n]),
            du: new Duration([90n, 1000n]),
            f: 1.5,
            f32: new F32(0.5),
            i: -42,
            i16: new I16(-300),
            u64: new U64(2n ** 63n + 7n),
            u8: new U8(200),
            uu: new Uuid(new Uint8Array(16).fill(0xab)),
        });
    });

    test("a sized kind keeps its kind rather than widening to a plain number", () => {
        const [value] = rows(
            shapeMessage(1, {
                fixedSize: 1,
                columns: [{ name: "n", kind: Kind.U8, slot: 0 }],
            }),
            batchMessage(1, [row({ fixed: new Fixed(1).u8(0, 7).bytes })]),
        );

        const n = (value as { n: unknown }).n;
        expect(n).toBeInstanceOf(U8);
        expect(n).toEqual(new U8(7));
        expect(typeof n).not.toBe("number");
    });

    test("the variable kinds read from their var slices", () => {
        const [value] = rows(
            shapeMessage(1, {
                varCount: 5,
                columns: [
                    { name: "by", kind: Kind.Bytes, slot: 1 },
                    { name: "de", kind: Kind.Decimal, slot: 2 },
                    { name: "dy", kind: Kind.Dynamic, slot: 4 },
                    { name: "re", kind: Kind.Record, slot: 3, table: "person" },
                    { name: "s", kind: Kind.String, slot: 0 },
                ],
            }),
            batchMessage(1, [
                row({
                    vars: [
                        utf8("hello"),
                        [1, 2, 3],
                        utf8("1.25"),
                        recordNumber(7n),
                        dynamic([1, "two"]),
                    ],
                }),
            ]),
        );

        expect(value).toEqual({
            // A byte string decodes to an ArrayBuffer, as it does on the CBOR path
            by: new Uint8Array([1, 2, 3]).buffer,
            de: new Decimal("1.25"),
            dy: [1, "two"],
            re: new RecordId("person", 7),
            s: "hello",
        });
    });

    test("a record carries its own table when the column does not name one", () => {
        const [value] = rows(
            shapeMessage(1, {
                varCount: 1,
                columns: [{ name: "r", kind: Kind.Record, slot: 0 }],
            }),
            batchMessage(1, [row({ vars: [recordString("abc", "thing")] })]),
        );

        expect(value).toEqual({ r: new RecordId("thing", "abc") });
    });

    test("an array of a fixed element kind reads every element", () => {
        const elements = new Fixed(24).i64(0, 1n).i64(8, 2n).i64(16, 3n);

        const [value] = rows(
            shapeMessage(1, {
                varCount: 1,
                columns: [{ name: "a", kind: Kind.Array, element: Kind.Int, slot: 0 }],
            }),
            batchMessage(1, [row({ vars: [fixedArray(3, elements.bytes)] })]),
        );

        expect(value).toEqual({ a: [1, 2, 3] });
    });

    test("an array of a variable element kind reads through its ends table", () => {
        const [value] = rows(
            shapeMessage(1, {
                varCount: 1,
                columns: [{ name: "a", kind: Kind.Array, element: Kind.String, slot: 0 }],
            }),
            batchMessage(1, [row({ vars: [varArray([utf8("one"), utf8(""), utf8("three")])] })]),
        );

        expect(value).toEqual({ a: ["one", "", "three"] });
    });

    test("a nanosecond datetime reads from its fixed slot, and from its overflow when it escapes", () => {
        const shape = {
            fixedSize: 16,
            varCount: 2,
            columns: [
                { name: "a", kind: Kind.DatetimeNs, slot: 0, rest: 0 },
                { name: "b", kind: Kind.DatetimeNs, slot: 8, rest: 1 },
            ],
        };

        const overflow = new Fixed(12).i64(0, 253402300799n).u32(8, 123);
        const [value] = rows(
            shapeMessage(1, shape),
            batchMessage(1, [
                row({
                    fixed: new Fixed(16).i64(0, 1_500_000_000_123_456_789n).i64(8, 2n ** 63n - 1n)
                        .bytes,
                    vars: [[], overflow.bytes],
                }),
            ]),
        );

        expect(value).toEqual({
            a: new DateTime([1500000000n, 123456789n]),
            b: new DateTime([253402300799n, 123n]),
        });
    });

    test("a nanosecond datetime before the epoch floors rather than truncates", () => {
        const [value] = rows(
            shapeMessage(1, {
                fixedSize: 8,
                varCount: 1,
                columns: [{ name: "t", kind: Kind.DatetimeNs, slot: 0, rest: 0 }],
            }),
            batchMessage(1, [
                row({ fixed: new Fixed(8).i64(0, -1_500_000_000n).bytes, vars: [[]] }),
            ]),
        );

        // -1.5s is 2 seconds before the epoch plus half a second, as the server reads it
        expect(value).toEqual({ t: new DateTime([-2n, 500000000n]) });
    });
});

describe("presence", () => {
    const shape = {
        presenceBits: 4,
        fixedSize: 10,
        columns: [
            {
                name: "maybe",
                kind: Kind.Int,
                slot: 0,
                flags: MAY_BE_ABSENT | MAY_BE_NULL,
                presence: 0,
            },
            { name: "nullable", kind: Kind.Bool, slot: 8, flags: MAY_BE_NULL, presence: 2 },
            { name: "optional", kind: Kind.Bool, slot: 9, flags: MAY_BE_ABSENT, presence: 3 },
        ],
    };

    /** One row of the shape above, whose four presence bits are `bits` */
    function states(bits: number): Record<string, unknown> {
        const [value] = rows(
            shapeMessage(1, shape),
            batchMessage(1, [
                row({
                    presence: [bits],
                    fixed: new Fixed(10).i64(0, 5n).u8(8, 1).u8(9, 1).bytes,
                }),
            ]),
        );
        return value as Record<string, unknown>;
    }

    test("a two-bit column reads a value, absent, NULL and NONE", () => {
        // 0b01 value, and the one-bit columns set so that they hold values
        expect(states(0b1101)).toEqual({ maybe: 5, nullable: true, optional: true });
        // 0b00 absent: the key is not in the object at all
        expect(Object.hasOwn(states(0b1100), "maybe")).toBe(false);
        // 0b10 NULL
        expect(states(0b1110).maybe).toBe(null);
        // 0b11 the key is present and its value is NONE
        expect(states(0b1111).maybe).toBe(undefined);
        expect(Object.hasOwn(states(0b1111), "maybe")).toBe(true);
    });

    test("a one-bit column clear is NULL when it may be null, and absent when it may be absent", () => {
        expect(states(0b1001).nullable).toBe(null);
        expect(Object.hasOwn(states(0b0101), "optional")).toBe(false);
    });

    test("a required column has no presence bits and always holds its value", () => {
        const [value] = rows(
            shapeMessage(1, {
                fixedSize: 8,
                columns: [{ name: "n", kind: Kind.Int, slot: 0 }],
            }),
            batchMessage(1, [row({ fixed: new Fixed(8).i64(0, 9n).bytes })]),
        );

        expect(value).toEqual({ n: 9 });
    });

    test("a hidden field is the same bytes as a key the row does not hold", () => {
        const hidden = states(0b1100);
        expect(Object.hasOwn(hidden, "maybe")).toBe(false);
        // Nothing in the decoded row says a value exists but was withheld
        expect(Object.keys(hidden).sort()).toEqual(["nullable", "optional"]);
    });

    test("presence padding bits which are set are refused", () => {
        expect(() =>
            rows(
                shapeMessage(1, {
                    presenceBits: 1,
                    fixedSize: 8,
                    columns: [
                        { name: "n", kind: Kind.Int, slot: 0, flags: MAY_BE_NULL, presence: 0 },
                    ],
                }),
                batchMessage(1, [row({ presence: [0b11], fixed: new Fixed(8).i64(0, 1n).bytes })]),
            ),
        ).toThrow(/padding bits set/);
    });
});

describe("objects and remainders", () => {
    test("an object column builds its value from the columns which follow it", () => {
        const [value] = rows(
            shapeMessage(1, {
                fixedSize: 9,
                columns: [
                    { name: "inner", kind: Kind.Object, slot: NO_SLOT, children: 2 },
                    { name: "x", kind: Kind.Int, slot: 0 },
                    { name: "y", kind: Kind.Bool, slot: 8 },
                    { name: "z", kind: Kind.Bool, slot: 8 },
                ],
            }),
            batchMessage(1, [row({ fixed: new Fixed(9).i64(0, 3n).u8(8, 1).bytes })]),
        );

        expect(value).toEqual({ inner: { x: 3, y: true }, z: true });
    });

    test("a node's remainder adds the entries which have no column", () => {
        const [value] = rows(
            shapeMessage(1, {
                fixedSize: 8,
                varCount: 1,
                rootRest: 0,
                columns: [{ name: "a", kind: Kind.Int, slot: 0 }],
            }),
            batchMessage(1, [
                row({
                    fixed: new Fixed(8).i64(0, 1n).bytes,
                    vars: [dynamic({ b: "extra" })],
                }),
            ]),
        );

        expect(value).toEqual({ a: 1, b: "extra" });
    });

    test("an empty remainder slice adds nothing", () => {
        const [value] = rows(
            shapeMessage(1, {
                fixedSize: 8,
                varCount: 1,
                rootRest: 0,
                columns: [{ name: "a", kind: Kind.Int, slot: 0 }],
            }),
            batchMessage(1, [row({ fixed: new Fixed(8).i64(0, 1n).bytes, vars: [[]] })]),
        );

        expect(value).toEqual({ a: 1 });
    });

    test("a remainder key which also has a column is refused", () => {
        expect(() =>
            rows(
                shapeMessage(1, {
                    fixedSize: 8,
                    varCount: 1,
                    rootRest: 0,
                    columns: [{ name: "a", kind: Kind.Int, slot: 0 }],
                }),
                batchMessage(1, [
                    row({
                        fixed: new Fixed(8).i64(0, 1n).bytes,
                        vars: [dynamic({ a: "collides" })],
                    }),
                ]),
            ),
        ).toThrow(/remainder key that has a column/);
    });

    test("a remainder which is not an object is refused", () => {
        expect(() =>
            rows(
                shapeMessage(1, { varCount: 1, rootRest: 0, columns: [] }),
                batchMessage(1, [row({ vars: [dynamic([1, 2])] })]),
            ),
        ).toThrow(/remainder that is not an object/);
    });
});

describe("roots and batches", () => {
    test("a value root is one dynamic value per row", () => {
        const values = rows(
            shapeMessage(1, { root: 1, varCount: 1, rootRest: 0 }),
            batchMessage(1, [row({ vars: [dynamic("one")] }), row({ vars: [dynamic(2)] })]),
        );

        expect(values).toEqual(["one", 2]);
    });

    test("an empty row list is a block of its version byte alone", () => {
        expect(rows()).toEqual([]);
    });

    test("rows keep their order across batches of one block", () => {
        const shape = { fixedSize: 8, columns: [{ name: "n", kind: Kind.Int, slot: 0 }] };
        const at = (n: bigint) => row({ fixed: new Fixed(8).i64(0, n).bytes });

        expect(
            rows(
                shapeMessage(1, shape),
                batchMessage(1, [at(1n), at(2n)]),
                batchMessage(1, [at(3n)]),
            ),
        ).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }]);
    });

    test("a message type this version does not know is skipped", () => {
        const unknown = new Uint8Array([0x7f, 0x02, 0x00, 0x00, 0x00, 0xaa, 0xbb]);

        expect(
            rows(
                shapeMessage(1, {
                    fixedSize: 8,
                    columns: [{ name: "n", kind: Kind.Int, slot: 0 }],
                }),
                unknown,
                batchMessage(1, [row({ fixed: new Fixed(8).i64(0, 4n).bytes })]),
            ),
        ).toEqual([{ n: 4 }]);
    });
});

describe("a scope holds its shapes across blocks", () => {
    const shape = { fixedSize: 8, columns: [{ name: "n", kind: Kind.Int, slot: 0 }] };
    const at = (n: bigint) => row({ fixed: new Fixed(8).i64(0, n).bytes });

    test("a later block names a shape the first announced", () => {
        const scope = new BlockReader();

        const first = scope.read(
            new ShapedBlock(blockContents(shapeMessage(1, shape), batchMessage(1, [at(1n)]))),
            codec.dynamic,
        );
        const second = scope.read(
            new ShapedBlock(blockContents(batchMessage(1, [at(2n)]))),
            codec.dynamic,
        );

        expect(first).toEqual([{ n: 1 }]);
        expect(second).toEqual([{ n: 2 }]);
    });

    test("announcing an id again replaces it for the batches which follow", () => {
        const scope = new BlockReader();

        scope.read(new ShapedBlock(blockContents(shapeMessage(1, shape))), codec.dynamic);
        const changed = scope.read(
            new ShapedBlock(
                blockContents(
                    shapeMessage(1, {
                        varCount: 1,
                        columns: [{ name: "s", kind: Kind.String, slot: 0 }],
                    }),
                    batchMessage(1, [row({ vars: [utf8("now a string")] })]),
                ),
            ),
            codec.dynamic,
        );

        expect(changed).toEqual([{ s: "now a string" }]);
    });

    test("a batch of a shape no scope announced is refused", () => {
        expect(() => rows(batchMessage(9, [at(1n)]))).toThrow(/unannounced shape/);
    });

    test("resetting a scope forgets its shapes", () => {
        const scope = new BlockReader();
        scope.read(new ShapedBlock(blockContents(shapeMessage(1, shape))), codec.dynamic);
        scope.reset();

        expect(() =>
            scope.read(new ShapedBlock(blockContents(batchMessage(1, [at(1n)]))), codec.dynamic),
        ).toThrow(/unannounced shape/);
    });
});

describe("what the decoder refuses", () => {
    const shape = { fixedSize: 8, columns: [{ name: "n", kind: Kind.Int, slot: 0 }] };
    const good = blockContents(
        shapeMessage(1, shape),
        batchMessage(1, [row({ fixed: new Fixed(8).i64(0, 1n).bytes })]),
    );

    test("a block version this decoder does not know", () => {
        const bytes = good.slice();
        bytes[0] = 2;
        expect(() => new BlockReader().read(new ShapedBlock(bytes), codec.dynamic)).toThrow(
            /unknown block version/,
        );
    });

    test("an unknown column kind", () => {
        expect(() =>
            rows(shapeMessage(1, { fixedSize: 8, columns: [{ name: "n", kind: 0x7e, slot: 0 }] })),
        ).toThrow(/unknown column kind/);
    });

    test("a fixed slot which runs past the fixed region", () => {
        expect(() =>
            rows(
                shapeMessage(1, {
                    fixedSize: 4,
                    columns: [{ name: "n", kind: Kind.Int, slot: 0 }],
                }),
            ),
        ).toThrow(/fixed slot out of range/);
    });

    test("a var slot which is not below the slot count", () => {
        expect(() =>
            rows(
                shapeMessage(1, {
                    varCount: 1,
                    columns: [{ name: "s", kind: Kind.String, slot: 1 }],
                }),
            ),
        ).toThrow(/var slot out of range/);
    });

    test("column names out of order", () => {
        expect(() =>
            rows(
                shapeMessage(1, {
                    fixedSize: 16,
                    columns: [
                        { name: "b", kind: Kind.Int, slot: 0 },
                        { name: "a", kind: Kind.Int, slot: 8 },
                    ],
                }),
            ),
        ).toThrow(/names out of order/);
    });

    test("an array column of no element kind", () => {
        expect(() =>
            rows(
                shapeMessage(1, {
                    varCount: 1,
                    columns: [{ name: "a", kind: Kind.Array, slot: 0 }],
                }),
            ),
        ).toThrow(/array of no element kind/);
    });

    test("bytes past a batch's rows", () => {
        // A batch whose payload holds one row and then a byte the count does not cover
        expect(() =>
            rows(
                shapeMessage(1, shape),
                batchMessage(1, [
                    new Uint8Array([...row({ fixed: new Fixed(8).i64(0, 1n).bytes }), 0xff]),
                ]),
            ),
        ).toThrow(/bytes past a batch's rows/);
    });

    test("a truncated row", () => {
        expect(() => rows(shapeMessage(1, shape), batchMessage(1, [new Uint8Array(4)]))).toThrow(
            /truncated row/,
        );
    });

    test("every truncation of a block is read or refused, never read past", () => {
        // A truncation which lands on a message boundary is a shorter block, and legitimately
        // reads; every other one is refused. Neither may fail in any other way, which is what
        // reading past the bytes would look like.
        for (let length = 0; length < good.length; length++) {
            const truncated = good.subarray(0, length);
            try {
                const read = new BlockReader().read(new ShapedBlock(truncated), codec.dynamic);
                expect(read.length).toBeLessThanOrEqual(1);
            } catch (error) {
                expect(error).toBeInstanceOf(ShapedFrameError);
            }
        }
    });

    test("every bit flip of a block is read or refused, never read past", () => {
        for (let at = 0; at < good.length; at++) {
            for (let bit = 0; bit < 8; bit++) {
                const flipped = good.slice();
                flipped[at] = (flipped[at] as number) ^ (1 << bit);
                try {
                    new BlockReader().read(new ShapedBlock(flipped), codec.dynamic);
                } catch (error) {
                    expect(error).toBeInstanceOf(SqonError);
                }
            }
        }
    });

    test("a bool which is neither 0 nor 1", () => {
        expect(() =>
            rows(
                shapeMessage(1, {
                    fixedSize: 1,
                    columns: [{ name: "b", kind: Kind.Bool, slot: 0 }],
                }),
                batchMessage(1, [row({ fixed: new Fixed(1).u8(0, 2).bytes })]),
            ),
        ).toThrow(/neither 0 nor 1/);
    });

    test("a string which is not UTF-8", () => {
        expect(() =>
            rows(
                shapeMessage(1, {
                    varCount: 1,
                    columns: [{ name: "s", kind: Kind.String, slot: 0 }],
                }),
                batchMessage(1, [row({ vars: [[0xff, 0xfe]] })]),
            ),
        ).toThrow(/not UTF-8/);
    });
});

describe("the codec", () => {
    test("tag 57 decodes to a block, which the scope then reads", () => {
        const bytes = codec.encode({ ok: true });
        expect(codec.decode<Record<string, unknown>>(bytes)).toEqual({ ok: true });

        const wrapped = block(
            shapeMessage(1, { fixedSize: 8, columns: [{ name: "n", kind: Kind.Int, slot: 0 }] }),
            batchMessage(1, [row({ fixed: new Fixed(8).i64(0, 5n).bytes })]),
        );

        const decoded = codec.decode<ShapedBlock>(wrapped);
        expect(decoded).toBeInstanceOf(ShapedBlock);
        expect(codec.rows(decoded, new BlockReader())).toEqual([{ n: 5 }]);
    });

    test("the shaped codec speaks cbor.2", () => {
        expect(codec.version).toBe(2);
    });

    test("plain cbor refuses a block rather than passing it through", () => {
        const wrapped = block();
        expect(() => new CborCodec({}).decode(wrapped)).toThrow(/shaped block/);
        expect(() => new CborCodec({ version: 2 }).decode(wrapped)).toThrow(/shaped block/);
    });
});
