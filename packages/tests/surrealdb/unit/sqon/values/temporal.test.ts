import { describe, expect, test } from "bun:test";
import {
    BigDecimal,
    CborCodec,
    Decimal,
    Future,
    Interval,
    InvalidDateError,
    InvalidDurationError,
    JsonCodec,
    PlainDate,
    PlainTime,
    Regex,
    Timestamp,
    toSurqlString,
    UnsupportedValueError,
} from "surrealdb";

const v1 = new CborCodec({});
const v2 = new CborCodec({ version: 2 });

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");
const bytes = (text: string) => new Uint8Array(Buffer.from(text, "hex"));

describe("PlainDate", () => {
    test("reads and writes YYYY-MM-DD", () => {
        const date = new PlainDate("2024-01-15");
        expect(date.days).toBe(19737);
        expect([date.year, date.month, date.day]).toEqual([2024, 1, 15]);
        expect(date.toString()).toBe("2024-01-15");
        expect(new PlainDate(0).toString()).toBe("1970-01-01");
        expect(new PlainDate(-1).toString()).toBe("1969-12-31");
    });

    test("writes a year outside 0 to 9999 with its sign, as the server does", () => {
        expect(new PlainDate("+10000-01-01").toString()).toBe("+10000-01-01");
        expect(new PlainDate("-0001-12-31").toString()).toBe("-0001-12-31");
        expect(new PlainDate("0000-02-29").toString()).toBe("0000-02-29");
    });

    test("has infinities at the ends of its range", () => {
        expect(PlainDate.INFINITY.toString()).toBe("infinity");
        expect(PlainDate.NEG_INFINITY.toString()).toBe("-infinity");
        expect(new PlainDate("-Infinity").equals(PlainDate.NEG_INFINITY)).toBe(true);
        expect(PlainDate.INFINITY.isInfinite).toBe(true);
        expect(() => new PlainDate(PlainDate.INFINITY.days + 1)).toThrow(InvalidDateError);
    });

    test("refuses a day past its month's end", () => {
        expect(() => new PlainDate("2023-02-29")).toThrow(InvalidDateError);
        expect(() => new PlainDate("2024-13-01")).toThrow(InvalidDateError);
    });

    test("reads epoch as 1970-01-01, as the server does", () => {
        expect(new PlainDate("epoch").days).toBe(0);
    });

    test("takes the UTC date of a Date", () => {
        expect(new PlainDate(new Date("2024-01-15T23:59:59Z")).toString()).toBe("2024-01-15");
    });
});

describe("PlainTime", () => {
    test("reads and writes a time of day", () => {
        expect(new PlainTime("9:05").toString()).toBe("09:05:00");
        expect(new PlainTime("12:34:56.5").toString()).toBe("12:34:56.500");
        expect(new PlainTime("12:34:56.123456").toString()).toBe("12:34:56.123456");
        expect(new PlainTime("12:34:56.000000001").nanos).toBe(45296000000001);
        expect(new PlainTime("24:00:00").toString()).toBe("24:00:00");
    });

    test("refuses what is past 24:00:00", () => {
        expect(() => new PlainTime("24:00:01")).toThrow(InvalidDateError);
        expect(() => new PlainTime("12:60")).toThrow(InvalidDateError);
        expect(() => new PlainTime(-1)).toThrow(InvalidDateError);
    });
});

describe("Timestamp", () => {
    test("reads and writes a wall-clock reading", () => {
        const ts = new Timestamp("2024-01-15T12:34:56.789");
        expect(ts.toCompact()).toEqual([1705322096, 789000000]);
        expect(ts.toString()).toBe("2024-01-15T12:34:56.789");
        expect(new Timestamp("2024-01-15 00:00").toString()).toBe("2024-01-15T00:00:00");
        expect(new Timestamp([-1, 0]).toString()).toBe("1969-12-31T23:59:59");
        expect(new Timestamp("epoch").toCompact()).toEqual([0, 0]);
    });

    test("has infinities at the ends of its range", () => {
        expect(Timestamp.INFINITY.toString()).toBe("infinity");
        expect(Timestamp.NEG_INFINITY.toString()).toBe("-infinity");
        expect(new Timestamp("infinity").isInfinite).toBe(true);
    });

    test("refuses 24:00 within a timestamp", () => {
        expect(() => new Timestamp("2024-01-15T24:00:00")).toThrow(InvalidDateError);
    });
});

describe("Interval", () => {
    test("writes ISO 8601 as the server does", () => {
        expect(new Interval({ months: 14, days: 3, micros: 3_723_500_000n }).toString()).toBe(
            "P1Y2M3DT1H2M3.5S",
        );
        expect(new Interval({}).toString()).toBe("PT0S");
        expect(new Interval({ micros: -90_000_000 }).toString()).toBe("PT-1M-30S");
    });

    test("equals by its normalised total, and is identical by its parts", () => {
        const month = new Interval({ months: 1 });
        const days = new Interval({ days: 30 });
        expect(month.equals(days)).toBe(true);
        expect(month.identical(days)).toBe(false);
    });

    test("refuses parts past their widths", () => {
        expect(() => new Interval({ months: 2 ** 31 })).toThrow(InvalidDurationError);
        expect(() => new Interval({ micros: 2n ** 63n })).toThrow(InvalidDurationError);
    });
});

describe("BigDecimal and Regex", () => {
    test("a bigdecimal keeps its text and equals its decimal", () => {
        const text = "12345678901234567890123456789012345.5";
        const big = new BigDecimal(text);
        expect(big.toString()).toBe(text);
        expect(big.equals(new Decimal(text))).toBe(true);
        expect(big.equals(new BigDecimal("1.5"))).toBe(false);
    });

    test("a bigdecimal written with an exponent keeps the positional text", () => {
        expect(new BigDecimal("1.5e3").toString()).toBe("1500");
        expect(new BigDecimal("-25E-3").toString()).toBe("-0.025");
    });

    test("a bigdecimal fits a decimal below 2^96 with at most 28 places", () => {
        expect(new BigDecimal("79228162514264337593543950335").fitsDecimal()).toBe(true);
        expect(new BigDecimal("79228162514264337593543950336").fitsDecimal()).toBe(false);
        expect(new BigDecimal(`0.${"1".repeat(28)}`).fitsDecimal()).toBe(true);
        expect(new BigDecimal(`0.${"1".repeat(29)}`).fitsDecimal()).toBe(false);
    });

    test("a regex escapes its slashes", () => {
        expect(new Regex("a/b").toString()).toBe("/a\\/b/");
        expect(new Regex("^a+$").toRegExp().test("aaa")).toBe(true);
    });
});

describe("cbor.2", () => {
    const cases: [string, unknown, string][] = [
        ["date", new PlainDate("2024-01-15"), "d864194d19"],
        ["time", new PlainTime("00:00:01"), "d8bd1a3b9aca00"],
        ["timestamp", new Timestamp([1, 2]), "d8be820102"],
        ["interval", new Interval([1, 2, 3]), "d8bf83010203"],
        ["bigdecimal", new BigDecimal("1.5"), "d8c063312e35"],
        ["regex", new Regex("a+"), "d8c162612b"],
    ];

    for (const [name, value, wire] of cases) {
        test(`writes and reads a ${name}`, () => {
            expect(hex(v2.encode(value))).toBe(wire);
            const back = v2.decode(bytes(wire)) as { equals(o: unknown): boolean };
            expect(back.equals(value)).toBe(true);
        });

        test(`plain cbor refuses a ${name} tag`, () => {
            expect(() => v1.decode(bytes(wire))).toThrow(UnsupportedValueError);
        });
    }

    test("reads a timestamp or interval whose parts are past 2^53", () => {
        const interval = v2.decode<Interval>(
            v2.encode(new Interval({ micros: 2n ** 62n })),
        ) as Interval;
        expect(interval.micros).toBe(2n ** 62n);
    });

    test("refuses a tag around the wrong content", () => {
        expect(() => v2.decode(bytes("d8646161"))).toThrow();
        expect(() => v2.decode(bytes("d8be8101"))).toThrow();
    });

    test("refuses to send a Future", () => {
        expect(() => v2.encode(new Future("{ 1 }"))).toThrow(UnsupportedValueError);
    });
});

describe("plain cbor widens the 4.0 types as the server does", () => {
    test("a date is a datetime at midnight UTC", () => {
        expect(hex(v1.encode(new PlainDate(1)))).toBe("cc821a0001518000");
    });

    test("a time is a duration since midnight", () => {
        expect(hex(v1.encode(new PlainTime("00:00:01.5")))).toBe("ce82011a1dcd6500");
        expect(hex(v1.encode(new PlainTime(0)))).toBe("ce80");
    });

    test("a timestamp is a datetime", () => {
        expect(hex(v1.encode(new Timestamp([1, 2])))).toBe("cc820102");
    });

    test("an interval is text", () => {
        expect(v1.decode(v1.encode(new Interval({ days: 1 })))).toBe("P1D");
    });

    test("a bigdecimal is a decimal when it fits one, and text otherwise", () => {
        expect(v1.decode(v1.encode(new BigDecimal("1.5")))).toEqual(new Decimal("1.5"));
        const text = "12345678901234567890123456789012345.5";
        expect(v1.decode(v1.encode(new BigDecimal(text)))).toBe(text);
    });

    test("a regex cannot be sent", () => {
        expect(() => v1.encode(new Regex("a"))).toThrow(UnsupportedValueError);
    });
});

describe("JSON and SurrealQL", () => {
    test("the JSON codec round-trips each type", () => {
        const values = [
            new PlainDate("2024-01-15"),
            new PlainTime("12:00:00.5"),
            new Timestamp("2024-01-15T12:00:00"),
            new Interval({ months: 1, days: 2, micros: 2n ** 60n }),
            new BigDecimal("1.25"),
            new Regex("a+"),
        ];
        for (const value of values) {
            const back = JsonCodec.DEFAULT.decode<typeof value>(JsonCodec.DEFAULT.encode(value));
            expect(back.equals(value)).toBe(true);
        }
    });

    test("the JSON codec leaves an object whose $interval is malformed as it is", () => {
        const value = { $interval: { months: "1" } };
        expect(JsonCodec.DEFAULT.decode(JsonCodec.DEFAULT.encode(value))).toEqual(value);
    });

    test("toSurqlString writes the literals the server parses", () => {
        expect(toSurqlString(new PlainDate("2024-01-15"))).toBe('date"2024-01-15"');
        expect(toSurqlString(new PlainTime("12:00"))).toBe('time"12:00:00"');
        expect(toSurqlString(new Timestamp([0, 0]))).toBe('timestamp"1970-01-01T00:00:00"');
        expect(toSurqlString(new Interval({ days: 1 }))).toBe('interval"P1D"');
        expect(toSurqlString(new BigDecimal("1.5"))).toBe("1.5bigdec");
        expect(toSurqlString(new Regex("a+"))).toBe("/a+/");
    });
});
