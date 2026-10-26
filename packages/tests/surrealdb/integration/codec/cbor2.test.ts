import { describe, expect, test } from "bun:test";
import {
    Decimal,
    F16,
    F32,
    I8,
    I16,
    I32,
    SizedNumber,
    SurrealSqonError,
    U8,
    U16,
    U32,
    U64,
} from "surrealdb";
import { createSurreal, SURREAL_BACKEND, speaksCbor2 } from "../__helpers__";

const CBOR2 = await speaksCbor2();

const SIZED = [
    new I8(-128),
    new U8(255),
    new I16(-32768),
    new U16(65535),
    new I32(-2147483648),
    new U32(4294967295),
    new U64(18446744073709551615n),
    new F16(1.5),
    new F32(0.1),
];

function expectSame(actual: unknown[], expected: SizedNumber[]) {
    expect(actual).toHaveLength(expected.length);

    for (const [i, value] of expected.entries()) {
        const got = actual[i];
        expect([i, got instanceof SizedNumber && got.equals(value)]).toEqual([i, true]);
    }
}

describe.if(CBOR2)("cbor.2", () => {
    test("reads the sized numbers as their kinds", async () => {
        const surreal = await createSurreal();

        const [values] = await surreal
            .query(
                "RETURN [-128i8, 255u8, -32768i16, 65535u16, -2147483648i32, 4294967295u32, 18446744073709551615u64, 1.5f16, 0.1f32]",
            )
            .collect<[unknown[]]>();

        expectSame(values, SIZED);
    });

    test("sends the sized numbers with their kinds", async () => {
        const surreal = await createSurreal();

        const [kinds, values] = await surreal
            .query("RETURN $values.map(|$v| type::of($v)); RETURN $values", { values: SIZED })
            .collect<[string[], unknown[]]>();

        expect(kinds).toEqual(SIZED.map((value) => value.kind));
        expectSame(values, SIZED);
    });

    test("an int stays an int", async () => {
        const surreal = await createSurreal();

        const [values] = await surreal.query("RETURN [5, 5u8]").collect<[unknown[]]>();

        expect(values[0]).toBe(5);
        expect(values[1]).toBeInstanceOf(U8);
    });
});

describe.if(SURREAL_BACKEND === "remote")("plain cbor", () => {
    test("sends and reads the sized numbers widened", async () => {
        // No cbor.2 codec: the connection speaks plain cbor, whatever the server
        const surreal = await createSurreal({
            driverOptions: { codecs: { cbor2: () => undefined } },
        });

        const [values] = await surreal
            .query("RETURN $values", { values: SIZED })
            .collect<[unknown[]]>();

        expect(values).toEqual([
            -128,
            255,
            -32768,
            65535,
            -2147483648,
            4294967295,
            new Decimal("18446744073709551615"),
            1.5,
            Math.fround(0.1),
        ]);
    });
});

describe.if(SURREAL_BACKEND === "remote")("integers past the signed 64-bit range", () => {
    test("are refused before they are sent, rather than wrapped", async () => {
        const surreal = await createSurreal();

        await expect(surreal.query("RETURN $v", { v: 2n ** 63n }).collect()).rejects.toBeInstanceOf(
            SurrealSqonError,
        );
    });
});
