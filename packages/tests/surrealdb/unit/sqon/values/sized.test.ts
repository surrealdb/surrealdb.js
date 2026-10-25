import { describe, expect, test } from "bun:test";
import {
    CborCodec,
    Decimal,
    F16,
    F32,
    I8,
    I16,
    I32,
    InvalidNumberError,
    JsonCodec,
    SizedNumber,
    U8,
    U16,
    U32,
    U64,
    Value,
} from "surrealdb";

describe("sized numbers", () => {
    test("hold the ends of their ranges", () => {
        expect(new I8(-128).value).toBe(-128);
        expect(new I8(127).value).toBe(127);
        expect(new U8(255).value).toBe(255);
        expect(new I16(-32768).value).toBe(-32768);
        expect(new U16(65535).value).toBe(65535);
        expect(new I32(-2147483648).value).toBe(-2147483648);
        expect(new U32(4294967295).value).toBe(4294967295);
        expect(new U64(2n ** 64n - 1n).value).toBe(2n ** 64n - 1n);
        expect(new U64(5).value).toBe(5n);
    });

    test("refuse what is outside their range, or not an integer", () => {
        expect(() => new I8(128)).toThrow(InvalidNumberError);
        expect(() => new U8(-1)).toThrow(InvalidNumberError);
        expect(() => new U16(65536)).toThrow(InvalidNumberError);
        expect(() => new U32(2 ** 32)).toThrow(InvalidNumberError);
        expect(() => new U64(2n ** 64n)).toThrow(InvalidNumberError);
        expect(() => new I32(1.5)).toThrow(InvalidNumberError);
        expect(() => new U64(2 ** 60)).toThrow(InvalidNumberError);
    });

    test("round floats to their width, as a cast does", () => {
        expect(new F32(0.1).value).toBe(Math.fround(0.1));
        expect(new F16(0.1).value).toBe(0.0999755859375);
        expect(new F16(65504).value).toBe(65504);
        expect(new F16(65520).value).toBe(Number.POSITIVE_INFINITY);
        expect(new F16(2 ** -24).value).toBe(2 ** -24);
        expect(Object.is(new F16(-0).value, -0)).toBe(true);
        expect(Number.isNaN(new F16(Number.NaN).value)).toBe(true);
        // Ties go to the even half: 2049 lies between 2048 and 2050
        expect(new F16(2049).value).toBe(2048);
        expect(new F16(2051).value).toBe(2052);
    });

    test("are their number to arithmetic and comparisons", () => {
        expect(+new U8(5) + 1).toBe(6);
        expect(new I32(-7) < new I32(3)).toBe(true);
        expect(new U64(10n).valueOf() * 2n).toBe(20n);
    });

    test("equal only a number of the same kind and value", () => {
        expect(new U8(5).equals(new U8(5))).toBe(true);
        expect(new U8(5).equals(new I8(5))).toBe(false);
        expect(new U8(5).equals(5)).toBe(false);
        expect(new F16(Number.NaN).equals(new F16(Number.NaN))).toBe(true);
        expect(new F32(0).equals(new F32(-0))).toBe(false);
    });

    test("are told apart by kind", () => {
        const value: unknown = new U16(1);
        expect(value instanceof SizedNumber).toBe(true);
        expect(value instanceof U16).toBe(true);
        expect(value instanceof I16).toBe(false);
        expect((value as SizedNumber).kind).toBe("u16");
    });

    test("serialise to JSON as their number, a u64 as a string", () => {
        expect(JSON.stringify([new U8(5), new F32(1.5), new U64(7n)])).toBe('[5,1.5,"7"]');
    });

    test("keep their kinds through the experimental JSON encoding", () => {
        const values = [
            new U8(5),
            new U64(7n),
            new U64(2n ** 64n - 1n),
            new F32(1.5),
            new F16(Number.NaN),
            new F32(-0),
            new F32(Number.NEGATIVE_INFINITY),
        ];
        const json =
            '[{"$u8":5},{"$u64":7},{"$u64":"18446744073709551615"},{"$f32":1.5},{"$f16":"NaN"},{"$f32":"-0"},{"$f32":"-Infinity"}]';

        Value.useExperimentalToJson(true);
        try {
            expect(JSON.stringify(values)).toBe(json);
        } finally {
            Value.useExperimentalToJson(false);
        }

        const decoded = JsonCodec.DEFAULT.decode<SizedNumber[]>(JSON.parse(json));
        expect(decoded.every((value, i) => value.equals(values[i]))).toBe(true);
    });

    test("are sent widened over plain cbor", () => {
        const codec = new CborCodec({});
        const decoded = codec.decode<unknown[]>(
            codec.encode([new U8(5), new F32(2), new U64(2n ** 64n - 1n), new U64(5n)]),
        );

        expect(decoded[0]).toBe(5);
        expect(decoded[1]).toBe(2);
        expect(decoded[2]).toEqual(new Decimal("18446744073709551615"));
        expect(decoded[3]).toBe(5);
    });

    test("a float of a sized kind stays a float over plain cbor", () => {
        // 0xf9 is a half-precision float head, where an integer would be 0x02
        expect(new CborCodec({}).encode(new F32(2))).toEqual(new Uint8Array([0xf9, 0x40, 0x00]));
    });

    test("a bigint past the signed 64-bit range is refused, rather than wrapped", () => {
        expect(() => new CborCodec({}).encode(2n ** 63n)).toThrow(InvalidNumberError);
        expect(() => new CborCodec({ version: 2 }).encode(-(2n ** 63n) - 1n)).toThrow(
            InvalidNumberError,
        );
        expect(new CborCodec({}).decode<bigint>(new CborCodec({}).encode(2n ** 63n - 1n))).toBe(
            2n ** 63n - 1n,
        );
    });
});
