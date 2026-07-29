import { describe, expect, test } from "bun:test";
import { TextParseError } from "../../errors.ts";
import { equals } from "../../utils/equals.ts";
import { BoundExcluded, BoundIncluded } from "../../utils/range.ts";
import {
    DateTime,
    Decimal,
    Duration,
    FileRef,
    GeometryPoint,
    Range,
    RecordId,
    RecordIdRange,
    Table,
    Uuid,
} from "../../value/index.ts";
import { TextCodec } from "./codec.ts";

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

describe("none / null / bool", () => {
    test("none is undefined (case-insensitive)", () => {
        expect(TextCodec.parseValue("NONE")).toBeUndefined();
        expect(TextCodec.parseValue("none")).toBeUndefined();
        expect(TextCodec.parseValue("None")).toBeUndefined();
    });

    test("null is null (case-insensitive)", () => {
        expect(TextCodec.parseValue("NULL")).toBeNull();
        expect(TextCodec.parseValue("null")).toBeNull();
        expect(TextCodec.parseValue("Null")).toBeNull();
    });

    test("booleans (case-insensitive)", () => {
        expect(TextCodec.parseValue("true")).toBe(true);
        expect(TextCodec.parseValue("TRUE")).toBe(true);
        expect(TextCodec.parseValue("false")).toBe(false);
        expect(TextCodec.parseValue("False")).toBe(false);
    });
});

describe("integers", () => {
    test("basic integers", () => {
        expect(TextCodec.parseValue("42")).toBe(42);
        expect(TextCodec.parseValue("-42")).toBe(-42);
        expect(TextCodec.parseValue("+7")).toBe(7);
        expect(TextCodec.parseValue("0")).toBe(0);
        expect(TextCodec.parseValue("-0")).toBe(0);
    });

    test("leading zeros", () => {
        expect(TextCodec.parseValue("007")).toBe(7);
    });

    test("underscore separators", () => {
        expect(TextCodec.parseValue("1_000_000")).toBe(1000000);
        expect(TextCodec.parseValue("-1_000")).toBe(-1000);
    });

    test("safe integer boundary stays a number", () => {
        expect(TextCodec.parseValue("9007199254740991")).toBe(9007199254740991);
        expect(typeof TextCodec.parseValue("9007199254740991")).toBe("number");
    });

    test("beyond safe integer becomes bigint", () => {
        expect(TextCodec.parseValue("9007199254740992")).toBe(9007199254740992n);
        expect(typeof TextCodec.parseValue("9007199254740992")).toBe("bigint");
        expect(TextCodec.parseValue("-9007199254740993")).toBe(-9007199254740993n);
        expect(TextCodec.parseValue("123456789012345678901234567890")).toBe(
            123456789012345678901234567890n,
        );
    });
});

describe("floats", () => {
    test("decimal point", () => {
        expect(TextCodec.parseValue("3.14")).toBe(3.14);
        expect(TextCodec.parseValue("-0.5")).toBe(-0.5);
        expect(TextCodec.parseValue("0.0")).toBe(0);
    });

    test("float suffix", () => {
        expect(TextCodec.parseValue("42f")).toBe(42);
        expect(TextCodec.parseValue("3.14f")).toBe(3.14);
    });

    test("exponents", () => {
        expect(TextCodec.parseValue("1e3")).toBe(1000);
        expect(TextCodec.parseValue("1E3")).toBe(1000);
        expect(TextCodec.parseValue("1e+3")).toBe(1000);
        expect(TextCodec.parseValue("1.5e-2")).toBe(0.015);
        expect(TextCodec.parseValue("2.5e2")).toBe(250);
    });

    test("a trailing 'e' with no digits is not an exponent", () => {
        // `3e` -> integer 3 with leftover `e`, which is trailing input.
        expect(() => TextCodec.parseValue("3e")).toThrow(TextParseError);
    });
});

describe("decimals", () => {
    test("plain decimal", () => {
        const value = TextCodec.parseValue("3.14159265358979dec");
        expect(value).toBeInstanceOf(Decimal);
        expect((value as Decimal).toString()).toBe("3.14159265358979");
    });

    test("integer decimal", () => {
        expect((TextCodec.parseValue("42dec") as Decimal).toString()).toBe("42");
    });

    test("scientific decimal", () => {
        expect(TextCodec.parseValue("1e2dec")).toBeInstanceOf(Decimal);
    });

    test("`3dec` is a decimal, `3d` is a duration", () => {
        expect(TextCodec.parseValue("3dec")).toBeInstanceOf(Decimal);
        expect(TextCodec.parseValue("3d")).toBeInstanceOf(Duration);
    });
});

describe("strings", () => {
    test("single and double quotes", () => {
        expect(TextCodec.parseValue("'hello'")).toBe("hello");
        expect(TextCodec.parseValue('"hello"')).toBe("hello");
        expect(TextCodec.parseValue("''")).toBe("");
    });

    test("explicit string prefix", () => {
        expect(TextCodec.parseValue('s"hello"')).toBe("hello");
        expect(TextCodec.parseValue("s'hello'")).toBe("hello");
    });

    test("escapes", () => {
        expect(TextCodec.parseValue("'a\\nb'")).toBe("a\nb");
        expect(TextCodec.parseValue("'a\\tb'")).toBe("a\tb");
        expect(TextCodec.parseValue("'a\\rb'")).toBe("a\rb");
        expect(TextCodec.parseValue("'a\\bb'")).toBe("a\bb");
        expect(TextCodec.parseValue("'a\\fb'")).toBe("a\fb");
        expect(TextCodec.parseValue("'a\\\\b'")).toBe("a\\b");
        expect(TextCodec.parseValue("'a\\/b'")).toBe("a/b");
        expect(TextCodec.parseValue("'it\\'s'")).toBe("it's");
        expect(TextCodec.parseValue('"say \\"hi\\""')).toBe('say "hi"');
    });

    test("mixed quotes need no escaping", () => {
        expect(TextCodec.parseValue("'say \"hi\"'")).toBe('say "hi"');
        expect(TextCodec.parseValue('"it\'s"')).toBe("it's");
    });

    test("unicode escapes", () => {
        expect(TextCodec.parseValue("'\\u0041'")).toBe("A");
        expect(TextCodec.parseValue("'\\u{1F600}'")).toBe("😀");
        expect(TextCodec.parseValue("'a\\u0042c'")).toBe("aBc");
    });

    test("unknown escape is passed through", () => {
        expect(TextCodec.parseValue("'\\q'")).toBe("q");
    });

    test("unicode content", () => {
        expect(TextCodec.parseValue("'héllo 世界 🌍'")).toBe("héllo 世界 🌍");
    });
});

// ---------------------------------------------------------------------------
// SurrealDB scalar types
// ---------------------------------------------------------------------------

describe("durations", () => {
    test("single unit", () => {
        expect((TextCodec.parseValue("100ms") as Duration).toString()).toBe("100ms");
        expect((TextCodec.parseValue("3d") as Duration).toString()).toBe("3d");
        expect((TextCodec.parseValue("500ns") as Duration).toString()).toBe("500ns");
    });

    test("multi unit", () => {
        expect((TextCodec.parseValue("1h30m") as Duration).toString()).toBe("1h30m");
        expect((TextCodec.parseValue("1y2w3d4h5m6s7ms8us9ns") as Duration).toString()).toBe(
            "1y2w3d4h5m6s7ms8us9ns",
        );
    });

    test("microsecond unit variants", () => {
        expect(TextCodec.parseValue("5µs")).toBeInstanceOf(Duration);
        expect(TextCodec.parseValue("5us")).toBeInstanceOf(Duration);
    });
});

describe("datetime", () => {
    test("basic", () => {
        const value = TextCodec.parseValue('d"2024-01-15T09:30:00Z"');
        expect(value).toBeInstanceOf(DateTime);
        expect((value as DateTime).toISOString()).toBe("2024-01-15T09:30:00.000Z");
    });

    test("nanosecond precision", () => {
        const value = TextCodec.parseValue('d"2024-01-15T09:30:00.123456789Z"') as DateTime;
        expect(value.toISOString()).toBe("2024-01-15T09:30:00.123456789Z");
    });

    test("single-quoted", () => {
        expect(TextCodec.parseValue("d'2024-01-15T09:30:00Z'")).toBeInstanceOf(DateTime);
    });

    test("useNativeDates option", () => {
        const value = TextCodec.parseValue('d"2024-01-15T09:30:00Z"', { useNativeDates: true });
        expect(value).toBeInstanceOf(Date);
        expect((value as Date).toISOString()).toBe("2024-01-15T09:30:00.000Z");
    });
});

describe("uuid", () => {
    test("double and single quoted", () => {
        const raw = "01924b3c-f1a2-7e3d-a001-2f4b8c9d0e1f";
        expect((TextCodec.parseValue(`u"${raw}"`) as Uuid).toString()).toBe(raw);
        expect((TextCodec.parseValue(`u'${raw}'`) as Uuid).toString()).toBe(raw);
    });
});

describe("bytes", () => {
    test("hex encoding", () => {
        const value = TextCodec.parseValue('b"48656C6C6F"');
        expect(value).toBeInstanceOf(Uint8Array);
        expect(new TextDecoder().decode(value as Uint8Array)).toBe("Hello");
    });

    test("lowercase hex", () => {
        expect([...(TextCodec.parseValue('b"deadbeef"') as Uint8Array)]).toEqual([
            0xde, 0xad, 0xbe, 0xef,
        ]);
    });

    test("empty bytes", () => {
        expect([...(TextCodec.parseValue('b""') as Uint8Array)]).toEqual([]);
    });

    test("base64url fallback for non-hex input", () => {
        expect(TextCodec.parseValue('b"SGVsbG8"')).toBeInstanceOf(Uint8Array);
    });
});

describe("file references", () => {
    test("bucket and key", () => {
        const value = TextCodec.parseValue('f"bucket:/path/to/file.txt"') as FileRef;
        expect(value.bucket).toBe("bucket");
        expect(value.key).toBe("/path/to/file.txt");
    });

    test("key without leading slash gets normalised", () => {
        const value = TextCodec.parseValue('f"bucket:file.txt"') as FileRef;
        expect(value.key).toBe("/file.txt");
    });

    test("missing colon throws", () => {
        expect(() => TextCodec.parseValue('f"no-separator"')).toThrow(TextParseError);
    });
});

// ---------------------------------------------------------------------------
// Tables, record ids & ranges
// ---------------------------------------------------------------------------

describe("tables", () => {
    test("bare identifier", () => {
        const value = TextCodec.parseValue("person");
        expect(value).toBeInstanceOf(Table);
        expect((value as Table).name).toBe("person");
    });

    test("backtick and angle-bracket identifiers", () => {
        expect((TextCodec.parseValue("`my table`") as Table).name).toBe("my table");
        expect((TextCodec.parseValue("⟨my table⟩") as Table).name).toBe("my table");
    });

    test("escaped delimiters inside identifiers", () => {
        expect((TextCodec.parseValue("`with\\`tick`") as Table).name).toBe("with`tick");
        expect((TextCodec.parseValue("⟨with\\⟩angle⟩") as Table).name).toBe("with⟩angle");
    });

    test("Infinity and NaN", () => {
        expect(TextCodec.parseValue("Infinity")).toBe(Number.POSITIVE_INFINITY);
        expect(Number.isNaN(TextCodec.parseValue("NaN") as number)).toBe(true);
    });
});

describe("record ids", () => {
    test("string key", () => {
        const value = TextCodec.parseValue("user:tobie") as RecordId;
        expect(value.table.name).toBe("user");
        expect(value.id).toBe("tobie");
    });

    test("numeric key", () => {
        expect((TextCodec.parseValue("user:42") as RecordId).id).toBe(42);
        expect((TextCodec.parseValue("user:+42") as RecordId).id).toBe(42);
    });

    test("negative numeric key", () => {
        expect((TextCodec.parseValue("temp:-5") as RecordId).id).toBe(-5);
    });

    test("bigint key", () => {
        expect((TextCodec.parseValue("big:9007199254740992") as RecordId).id).toBe(
            9007199254740992n,
        );
    });

    test("angle-bracketed digits stay a string", () => {
        expect((TextCodec.parseValue("user:⟨123⟩") as RecordId).id).toBe("123");
    });

    test("quoted string key", () => {
        expect((TextCodec.parseValue("user:'complex key'") as RecordId).id).toBe("complex key");
    });

    test("backtick table and key", () => {
        const value = TextCodec.parseValue("`my table`:`the id`") as RecordId;
        expect(value.table.name).toBe("my table");
        expect(value.id).toBe("the id");
    });

    test("uuid key", () => {
        const value = TextCodec.parseValue(
            'user:u"01924b3c-f1a2-7e3d-a001-2f4b8c9d0e1f"',
        ) as RecordId;
        expect(value.id).toBeInstanceOf(Uuid);
    });

    test("object key", () => {
        const value = TextCodec.parseValue("user:{ name: 'john', age: 30 }") as RecordId;
        expect(value.id).toEqual({ name: "john", age: 30 });
    });

    test("array key", () => {
        const value = TextCodec.parseValue("temperature:['London', 2022]") as RecordId;
        expect(value.id).toEqual(["London", 2022]);
    });

    test("table names starting with a literal prefix letter", () => {
        // `d`, `u`, `s`, ... are only literal prefixes when directly followed by a quote.
        expect((TextCodec.parseValue("device:1") as RecordId).table.name).toBe("device");
        expect((TextCodec.parseValue("f:1") as RecordId).table.name).toBe("f");
        expect(TextCodec.parseValue("send")).toBeInstanceOf(Table);
    });

    test("r-string record id", () => {
        const value = TextCodec.parseValue('r"user:tobie"') as RecordId;
        expect(value.table.name).toBe("user");
        expect(value.id).toBe("tobie");
    });

    test("r-string record id range", () => {
        expect(TextCodec.parseValue('r"user:1..5"')).toBeInstanceOf(RecordIdRange);
    });
});

describe("record id ranges", () => {
    test("exclusive end (default)", () => {
        const value = TextCodec.parseValue("user:1..5") as RecordIdRange;
        expect(value).toBeInstanceOf(RecordIdRange);
        expect(value.begin).toEqual(new BoundIncluded(1));
        expect(value.end).toEqual(new BoundExcluded(5));
    });

    test("inclusive end", () => {
        expect((TextCodec.parseValue("user:1..=5") as RecordIdRange).end).toEqual(
            new BoundIncluded(5),
        );
    });

    test("exclusive start", () => {
        expect((TextCodec.parseValue("user:1>..5") as RecordIdRange).begin).toEqual(
            new BoundExcluded(1),
        );
    });

    test("exclusive start, inclusive end", () => {
        const value = TextCodec.parseValue("user:1>..=5") as RecordIdRange;
        expect(value.begin).toEqual(new BoundExcluded(1));
        expect(value.end).toEqual(new BoundIncluded(5));
    });

    test("open upper bound", () => {
        const value = TextCodec.parseValue("user:5..") as RecordIdRange;
        expect(value.begin).toEqual(new BoundIncluded(5));
        expect(value.end).toBeUndefined();
    });

    test("open lower bound", () => {
        const value = TextCodec.parseValue("user:..5") as RecordIdRange;
        expect(value.begin).toBeUndefined();
        expect(value.end).toEqual(new BoundExcluded(5));
    });

    test("string bounds", () => {
        const value = TextCodec.parseValue("user:'a'..'z'") as RecordIdRange;
        expect(value.begin).toEqual(new BoundIncluded("a"));
        expect(value.end).toEqual(new BoundExcluded("z"));
    });
});

describe("ranges", () => {
    test("numeric range", () => {
        const value = TextCodec.parseValue("0..10") as Range<number, number>;
        expect(value).toBeInstanceOf(Range);
        expect(value.begin).toEqual(new BoundIncluded(0));
        expect(value.end).toEqual(new BoundExcluded(10));
    });

    test("inclusive and exclusive-start", () => {
        expect((TextCodec.parseValue("0..=10") as Range<number, number>).end).toEqual(
            new BoundIncluded(10),
        );
        expect((TextCodec.parseValue("0>..10") as Range<number, number>).begin).toEqual(
            new BoundExcluded(0),
        );
        const both = TextCodec.parseValue("0>..=10") as Range<number, number>;
        expect(both.begin).toEqual(new BoundExcluded(0));
        expect(both.end).toEqual(new BoundIncluded(10));
    });

    test("fully unbounded", () => {
        const value = TextCodec.parseValue("..") as Range<unknown, unknown>;
        expect(value.begin).toBeUndefined();
        expect(value.end).toBeUndefined();
    });

    test("open upper and lower bounds", () => {
        const lower = TextCodec.parseValue("5..") as Range<number, number>;
        expect(lower.begin).toEqual(new BoundIncluded(5));
        expect(lower.end).toBeUndefined();

        const upper = TextCodec.parseValue("..5") as Range<number, number>;
        expect(upper.begin).toBeUndefined();
        expect(upper.end).toEqual(new BoundExcluded(5));

        const upperInclusive = TextCodec.parseValue("..=5") as Range<number, number>;
        expect(upperInclusive.end).toEqual(new BoundIncluded(5));
    });

    test("string, decimal and datetime bounds", () => {
        expect((TextCodec.parseValue("'a'..'z'") as Range<string, string>).begin).toEqual(
            new BoundIncluded("a"),
        );
        const dec = TextCodec.parseValue("1.5..3.5") as Range<number, number>;
        expect(dec.begin).toEqual(new BoundIncluded(1.5));
        expect(dec.end).toEqual(new BoundExcluded(3.5));
    });

    test("whitespace around the range operator", () => {
        const value = TextCodec.parseValue("0 .. 10") as Range<number, number>;
        expect(value.begin).toEqual(new BoundIncluded(0));
        expect(value.end).toEqual(new BoundExcluded(10));
    });

    test("inclusive range with no end value throws", () => {
        expect(() => TextCodec.parseValue("5..=")).toThrow(TextParseError);
    });
});

// ---------------------------------------------------------------------------
// Collections
// ---------------------------------------------------------------------------

describe("arrays", () => {
    test("empty and simple", () => {
        expect(TextCodec.parseValue("[]")).toEqual([]);
        expect(TextCodec.parseValue("[1, 2, 3]")).toEqual([1, 2, 3]);
    });

    test("mixed types", () => {
        expect(TextCodec.parseValue("[1, 'two', true, NONE, NULL]")).toEqual([
            1,
            "two",
            true,
            undefined,
            null,
        ]);
    });

    test("trailing comma", () => {
        expect(TextCodec.parseValue("[1, 2, 3,]")).toEqual([1, 2, 3]);
    });

    test("nested", () => {
        expect(TextCodec.parseValue("[[1, 2], [3, [4]]]")).toEqual([
            [1, 2],
            [3, [4]],
        ]);
    });

    test("mixed value types including records and ranges", () => {
        const arr = TextCodec.parseValue("[user:1..5, person:tobie, 0..10]") as unknown[];
        expect(arr[0]).toBeInstanceOf(RecordIdRange);
        expect(arr[1]).toBeInstanceOf(RecordId);
        expect(arr[2]).toBeInstanceOf(Range);
    });

    test("missing separator throws", () => {
        expect(() => TextCodec.parseValue("[1 2]")).toThrow(TextParseError);
        expect(() => TextCodec.parseValue("[1,")).toThrow(TextParseError);
    });
});

describe("objects", () => {
    test("empty object", () => {
        expect(TextCodec.parseValue("{}")).toEqual({});
    });

    test("bare, quoted and numeric keys", () => {
        expect(TextCodec.parseValue("{ name: 'Jane', age: 30 }")).toEqual({
            name: "Jane",
            age: 30,
        });
        expect(TextCodec.parseValue("{ 'quoted key': 1, \"other\": 2 }")).toEqual({
            "quoted key": 1,
            other: 2,
        });
        expect(TextCodec.parseValue("{ 1: 'one' }")).toEqual({ "1": "one" });
    });

    test("dollar-prefixed (quoted) keys have no special meaning", () => {
        // Unlike the JSON codec, the text codec has no `$`-prefix escaping.
        expect(TextCodec.parseValue("{ '$foo': 1, '$bar': 2 }")).toEqual({ $foo: 1, $bar: 2 });
    });

    test("trailing comma", () => {
        expect(TextCodec.parseValue("{ a: 1, b: 2, }")).toEqual({ a: 1, b: 2 });
    });

    test("nested objects and arrays", () => {
        expect(TextCodec.parseValue("{ list: [1, { deep: true }], flag: false }")).toEqual({
            list: [1, { deep: true }],
            flag: false,
        });
    });

    test("value that is itself a record id", () => {
        const value = TextCodec.parseValue("{ owner: user:tobie }") as { owner: RecordId };
        expect(value.owner).toBeInstanceOf(RecordId);
    });

    test("missing colon or brace throws", () => {
        expect(() => TextCodec.parseValue("{ a 1 }")).toThrow(TextParseError);
        expect(() => TextCodec.parseValue("{ a: 1")).toThrow(TextParseError);
    });
});

describe("sets", () => {
    test("multiple elements", () => {
        const value = TextCodec.parseValue("{ 1, 2, 3 }");
        expect(value).toBeInstanceOf(Set);
        expect([...(value as Set<number>)]).toEqual([1, 2, 3]);
    });

    test("single element", () => {
        const value = TextCodec.parseValue("{ person }");
        expect(value).toBeInstanceOf(Set);
        expect([...(value as Set<unknown>)][0]).toBeInstanceOf(Table);
    });

    test("trailing comma", () => {
        expect([...(TextCodec.parseValue("{ 1, 2, }") as Set<number>)]).toEqual([1, 2]);
    });

    test("de-duplicates equal primitives", () => {
        expect([...(TextCodec.parseValue("{ 1, 1, 2 }") as Set<number>)]).toEqual([1, 2]);
    });
});

// ---------------------------------------------------------------------------
// Geometry & grouping
// ---------------------------------------------------------------------------

describe("geometry & grouping", () => {
    test("point", () => {
        const value = TextCodec.parseValue("(-122.4194, 37.7749)");
        expect(value).toBeInstanceOf(GeometryPoint);
        expect((value as GeometryPoint).point).toEqual([-122.4194, 37.7749]);
    });

    test("point with whitespace and integer coordinates", () => {
        expect((TextCodec.parseValue("( 1 , 2 )") as GeometryPoint).point).toEqual([1, 2]);
    });

    test("grouped expression", () => {
        expect(TextCodec.parseValue("(42)")).toBe(42);
        expect(TextCodec.parseValue("('hello')")).toBe("hello");
        expect(TextCodec.parseValue("((1))")).toBe(1);
    });

    test("grouped record id", () => {
        expect(TextCodec.parseValue("(user:tobie)")).toBeInstanceOf(RecordId);
    });

    test("three-element parenthesised list is not a point", () => {
        expect(() => TextCodec.parseValue("(1, 2, 3)")).toThrow(TextParseError);
    });
});

// ---------------------------------------------------------------------------
// Whitespace & errors
// ---------------------------------------------------------------------------

describe("whitespace & errors", () => {
    test("tolerates surrounding whitespace and newlines", () => {
        expect(TextCodec.parseValue("   42   ")).toBe(42);
        expect(TextCodec.parseValue("\n\t[ 1 , 2 ]\n")).toEqual([1, 2]);
        expect(TextCodec.parseValue("\r\n'x'\r\n")).toBe("x");
    });

    test("rejects trailing input", () => {
        expect(() => TextCodec.parseValue("42 43")).toThrow(TextParseError);
        expect(() => TextCodec.parseValue("[1, 2] extra")).toThrow(TextParseError);
    });

    test("rejects unterminated string", () => {
        expect(() => TextCodec.parseValue("'oops")).toThrow(TextParseError);
    });

    test("rejects unterminated identifier", () => {
        expect(() => TextCodec.parseValue("`oops")).toThrow(TextParseError);
        expect(() => TextCodec.parseValue("⟨oops")).toThrow(TextParseError);
    });

    test("rejects empty or whitespace-only input", () => {
        expect(() => TextCodec.parseValue("")).toThrow(TextParseError);
        expect(() => TextCodec.parseValue("   ")).toThrow(TextParseError);
    });

    test("rejects a lone sign", () => {
        expect(() => TextCodec.parseValue("+")).toThrow(TextParseError);
        expect(() => TextCodec.parseValue("-")).toThrow(TextParseError);
    });

    test("rejects an unexpected character", () => {
        expect(() => TextCodec.parseValue("%")).toThrow(TextParseError);
        expect(() => TextCodec.parseValue("@")).toThrow(TextParseError);
    });

    test("rejects an empty record id key", () => {
        expect(() => TextCodec.parseValue("user:")).toThrow(TextParseError);
    });

    test("rejects invalid unicode escape", () => {
        expect(() => TextCodec.parseValue("'\\uZZZZ'")).toThrow(TextParseError);
        expect(() => TextCodec.parseValue("'\\u{'")).toThrow(TextParseError);
    });

    test("error carries a character offset", () => {
        try {
            TextCodec.parseValue("[1, 2] boom");
            throw new Error("expected a parse error");
        } catch (error) {
            expect(error).toBeInstanceOf(TextParseError);
            expect((error as TextParseError).offset).toBeGreaterThan(0);
        }
    });
});

// ---------------------------------------------------------------------------
// TextCodec API
// ---------------------------------------------------------------------------

describe("TextCodec", () => {
    const codec = new TextCodec();

    test("decode delegates to the parser", () => {
        expect(codec.decode("user:tobie")).toBeInstanceOf(RecordId);
    });

    test("encode produces SurrealQL text", () => {
        expect(codec.encode(new RecordId("user", "tobie"))).toBe('r"user:tobie"');
        expect(codec.encode([1, 2, 3])).toBe("[ 1, 2, 3 ]");
    });

    test("DEFAULT is a reusable instance", () => {
        expect(TextCodec.DEFAULT.decode<number>("42")).toBe(42);
    });

    test("respects useNativeDates option", () => {
        const native = new TextCodec({ useNativeDates: true });
        expect(native.decode('d"2024-01-15T09:30:00Z"')).toBeInstanceOf(Date);
    });

    test("parseValue is a static shortcut for decoding", () => {
        expect(TextCodec.parseValue("true")).toBe(true);
    });
});

describe("TextCodec typed static methods", () => {
    test("each returns the expected type", () => {
        expect(TextCodec.parseValue("42")).toBe(42);
        expect(TextCodec.parseString("'hi'")).toBe("hi");
        expect(TextCodec.parseNumber("3.14")).toBe(3.14);
        expect(TextCodec.parseNumber("9007199254740992")).toBe(9007199254740992n);
        expect(TextCodec.parseBool("true")).toBe(true);
        expect(TextCodec.parseDecimal("3.14dec")).toBeInstanceOf(Decimal);
        expect(TextCodec.parseDuration("1h30m")).toBeInstanceOf(Duration);
        expect(TextCodec.parseDatetime('d"2024-01-15T09:30:00Z"')).toBeInstanceOf(DateTime);
        expect(TextCodec.parseUuid('u"01924b3c-f1a2-7e3d-a001-2f4b8c9d0e1f"')).toBeInstanceOf(Uuid);
        expect(TextCodec.parseBytes('b"48656C6C6F"')).toBeInstanceOf(Uint8Array);
        expect(TextCodec.parseFile('f"bucket:/f.txt"')).toBeInstanceOf(FileRef);
        expect(TextCodec.parseTable("person")).toBeInstanceOf(Table);
        expect(TextCodec.parseRecordId("user:tobie")).toBeInstanceOf(RecordId);
        expect(TextCodec.parseRecordIdRange("user:1..5")).toBeInstanceOf(RecordIdRange);
        expect(TextCodec.parseRange("0..10")).toBeInstanceOf(Range);
        expect(TextCodec.parseGeometryPoint("(1, 2)")).toBeInstanceOf(GeometryPoint);
        expect(TextCodec.parseArray("[1, 2]")).toEqual([1, 2]);
        expect([...TextCodec.parseSet("{ 1, 2 }")]).toEqual([1, 2]);
        expect(TextCodec.parseObject("{ a: 1 }")).toEqual({ a: 1 });
    });

    test("static methods honour options", () => {
        expect(
            TextCodec.parseDatetime('d"2024-01-15T09:30:00Z"', { useNativeDates: true }),
        ).toBeInstanceOf(Date);
    });

    test("throw when the parsed value is the wrong type", () => {
        expect(() => TextCodec.parseArray("42")).toThrow(TextParseError);
        expect(() => TextCodec.parseRecordId("user:1..5")).toThrow(TextParseError);
        expect(() => TextCodec.parseObject("{ 1, 2 }")).toThrow(TextParseError);
        expect(() => TextCodec.parseNumber("'not a number'")).toThrow(TextParseError);
        expect(() => TextCodec.parseTable("user:1")).toThrow(TextParseError);
    });

    test("still enforce full-input consumption", () => {
        expect(() => TextCodec.parseArray("[1, 2] extra")).toThrow(TextParseError);
    });
});

// ---------------------------------------------------------------------------
// Round-trips
// ---------------------------------------------------------------------------

describe("value round-trips (decode(encode(value)) equals value)", () => {
    const codec = new TextCodec();

    const cases: [string, unknown][] = [
        ["int", 42],
        ["negative int", -17],
        ["bigint", 9007199254740992n],
        ["float", 3.14],
        ["zero", 0],
        ["true", true],
        ["false", false],
        ["null", null],
        ["none", undefined],
        ["string", "hello world"],
        ["empty string", ""],
        ["array", [1, 2, 3]],
        ["nested array", [1, [2, [3]]]],
        ["object", { name: "Jane", age: 30 }],
        ["nested object", { a: { b: { c: 1 } } }],
        ["decimal", new Decimal("3.14159")],
        ["duration", new Duration("1h30m")],
        ["uuid", new Uuid("01924b3c-f1a2-7e3d-a001-2f4b8c9d0e1f")],
        ["datetime", new DateTime("2024-01-15T09:30:00.123456789Z")],
        ["table", new Table("person")],
        ["table needing escaping", new Table("some-table")],
        ["record id (string)", new RecordId("user", "tobie")],
        ["record id (numeric)", new RecordId("user", 42)],
        ["record id range", new RecordIdRange("user", new BoundIncluded(1), new BoundExcluded(5))],
        [
            "record id range (inclusive)",
            new RecordIdRange("user", new BoundIncluded(1), new BoundIncluded(1000)),
        ],
        ["range", new Range(new BoundIncluded(0), new BoundExcluded(10))],
        ["file", new FileRef("bucket", "/path/to/file.txt")],
    ];

    for (const [name, value] of cases) {
        test(name, () => {
            const encoded = codec.encode(value);
            const decoded = codec.decode(encoded);
            expect(equals(decoded, value)).toBe(true);
            // Re-encoding the decoded value is stable.
            expect(codec.encode(decoded)).toBe(encoded);
        });
    }
});

describe("text round-trips (encode(decode(text)) equals text)", () => {
    const codec = new TextCodec();

    const texts = [
        "42",
        "3.14",
        "true",
        "NULL",
        "NONE",
        "[ 1, 2, 3 ]",
        "3.14159dec",
        "1h30m",
        'u"01924b3c-f1a2-7e3d-a001-2f4b8c9d0e1f"',
        'd"2024-01-15T09:30:00.123456789Z"',
        'r"user:tobie"',
        "user:1..1000",
        "0..10",
        'f"bucket:/path/to/file.txt"',
    ];

    for (const text of texts) {
        test(text, () => {
            expect(codec.encode(codec.decode(text))).toBe(text);
        });
    }
});

describe("documented lossy encodings", () => {
    const codec = new TextCodec();

    test("sets are encoded as arrays", () => {
        expect(codec.encode(new Set([1, 2, 3]))).toBe("[ 1, 2, 3 ]");
        expect(codec.decode<number[]>(codec.encode(new Set([1, 2, 3])))).toEqual([1, 2, 3]);
    });

    test("geometry is encoded as a GeoJSON object", () => {
        const decoded = codec.decode(codec.encode(new GeometryPoint([1.5, 2.5])));
        expect(decoded).toEqual({ type: "Point", coordinates: [1.5, 2.5] });
    });
});
