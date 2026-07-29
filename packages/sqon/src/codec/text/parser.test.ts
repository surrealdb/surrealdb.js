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
import { parseText, TextParser } from "./parser.ts";

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

describe("none / null / bool", () => {
    test("none is undefined (case-insensitive)", () => {
        expect(parseText("NONE")).toBeUndefined();
        expect(parseText("none")).toBeUndefined();
        expect(parseText("None")).toBeUndefined();
    });

    test("null is null (case-insensitive)", () => {
        expect(parseText("NULL")).toBeNull();
        expect(parseText("null")).toBeNull();
        expect(parseText("Null")).toBeNull();
    });

    test("booleans (case-insensitive)", () => {
        expect(parseText("true")).toBe(true);
        expect(parseText("TRUE")).toBe(true);
        expect(parseText("false")).toBe(false);
        expect(parseText("False")).toBe(false);
    });
});

describe("integers", () => {
    test("basic integers", () => {
        expect(parseText("42")).toBe(42);
        expect(parseText("-42")).toBe(-42);
        expect(parseText("+7")).toBe(7);
        expect(parseText("0")).toBe(0);
        expect(parseText("-0")).toBe(0);
    });

    test("leading zeros", () => {
        expect(parseText("007")).toBe(7);
    });

    test("underscore separators", () => {
        expect(parseText("1_000_000")).toBe(1000000);
        expect(parseText("-1_000")).toBe(-1000);
    });

    test("safe integer boundary stays a number", () => {
        expect(parseText("9007199254740991")).toBe(9007199254740991);
        expect(typeof parseText("9007199254740991")).toBe("number");
    });

    test("beyond safe integer becomes bigint", () => {
        expect(parseText("9007199254740992")).toBe(9007199254740992n);
        expect(typeof parseText("9007199254740992")).toBe("bigint");
        expect(parseText("-9007199254740993")).toBe(-9007199254740993n);
        expect(parseText("123456789012345678901234567890")).toBe(123456789012345678901234567890n);
    });
});

describe("floats", () => {
    test("decimal point", () => {
        expect(parseText("3.14")).toBe(3.14);
        expect(parseText("-0.5")).toBe(-0.5);
        expect(parseText("0.0")).toBe(0);
    });

    test("float suffix", () => {
        expect(parseText("42f")).toBe(42);
        expect(parseText("3.14f")).toBe(3.14);
    });

    test("exponents", () => {
        expect(parseText("1e3")).toBe(1000);
        expect(parseText("1E3")).toBe(1000);
        expect(parseText("1e+3")).toBe(1000);
        expect(parseText("1.5e-2")).toBe(0.015);
        expect(parseText("2.5e2")).toBe(250);
    });

    test("a trailing 'e' with no digits is not an exponent", () => {
        // `3e` -> integer 3 with leftover `e`, which is trailing input.
        expect(() => parseText("3e")).toThrow(TextParseError);
    });
});

describe("decimals", () => {
    test("plain decimal", () => {
        const value = parseText("3.14159265358979dec");
        expect(value).toBeInstanceOf(Decimal);
        expect((value as Decimal).toString()).toBe("3.14159265358979");
    });

    test("integer decimal", () => {
        expect((parseText("42dec") as Decimal).toString()).toBe("42");
    });

    test("scientific decimal", () => {
        expect(parseText("1e2dec")).toBeInstanceOf(Decimal);
    });

    test("`3dec` is a decimal, `3d` is a duration", () => {
        expect(parseText("3dec")).toBeInstanceOf(Decimal);
        expect(parseText("3d")).toBeInstanceOf(Duration);
    });
});

describe("strings", () => {
    test("single and double quotes", () => {
        expect(parseText("'hello'")).toBe("hello");
        expect(parseText('"hello"')).toBe("hello");
        expect(parseText("''")).toBe("");
    });

    test("explicit string prefix", () => {
        expect(parseText('s"hello"')).toBe("hello");
        expect(parseText("s'hello'")).toBe("hello");
    });

    test("escapes", () => {
        expect(parseText("'a\\nb'")).toBe("a\nb");
        expect(parseText("'a\\tb'")).toBe("a\tb");
        expect(parseText("'a\\rb'")).toBe("a\rb");
        expect(parseText("'a\\bb'")).toBe("a\bb");
        expect(parseText("'a\\fb'")).toBe("a\fb");
        expect(parseText("'a\\\\b'")).toBe("a\\b");
        expect(parseText("'a\\/b'")).toBe("a/b");
        expect(parseText("'it\\'s'")).toBe("it's");
        expect(parseText('"say \\"hi\\""')).toBe('say "hi"');
    });

    test("mixed quotes need no escaping", () => {
        expect(parseText("'say \"hi\"'")).toBe('say "hi"');
        expect(parseText('"it\'s"')).toBe("it's");
    });

    test("unicode escapes", () => {
        expect(parseText("'\\u0041'")).toBe("A");
        expect(parseText("'\\u{1F600}'")).toBe("😀");
        expect(parseText("'a\\u0042c'")).toBe("aBc");
    });

    test("unknown escape is passed through", () => {
        expect(parseText("'\\q'")).toBe("q");
    });

    test("unicode content", () => {
        expect(parseText("'héllo 世界 🌍'")).toBe("héllo 世界 🌍");
    });
});

// ---------------------------------------------------------------------------
// SurrealDB scalar types
// ---------------------------------------------------------------------------

describe("durations", () => {
    test("single unit", () => {
        expect((parseText("100ms") as Duration).toString()).toBe("100ms");
        expect((parseText("3d") as Duration).toString()).toBe("3d");
        expect((parseText("500ns") as Duration).toString()).toBe("500ns");
    });

    test("multi unit", () => {
        expect((parseText("1h30m") as Duration).toString()).toBe("1h30m");
        expect((parseText("1y2w3d4h5m6s7ms8us9ns") as Duration).toString()).toBe(
            "1y2w3d4h5m6s7ms8us9ns",
        );
    });

    test("microsecond unit variants", () => {
        expect(parseText("5µs")).toBeInstanceOf(Duration);
        expect(parseText("5us")).toBeInstanceOf(Duration);
    });
});

describe("datetime", () => {
    test("basic", () => {
        const value = parseText('d"2024-01-15T09:30:00Z"');
        expect(value).toBeInstanceOf(DateTime);
        expect((value as DateTime).toISOString()).toBe("2024-01-15T09:30:00.000Z");
    });

    test("nanosecond precision", () => {
        const value = parseText('d"2024-01-15T09:30:00.123456789Z"') as DateTime;
        expect(value.toISOString()).toBe("2024-01-15T09:30:00.123456789Z");
    });

    test("single-quoted", () => {
        expect(parseText("d'2024-01-15T09:30:00Z'")).toBeInstanceOf(DateTime);
    });

    test("useNativeDates option", () => {
        const value = parseText('d"2024-01-15T09:30:00Z"', { useNativeDates: true });
        expect(value).toBeInstanceOf(Date);
        expect((value as Date).toISOString()).toBe("2024-01-15T09:30:00.000Z");
    });
});

describe("uuid", () => {
    test("double and single quoted", () => {
        const raw = "01924b3c-f1a2-7e3d-a001-2f4b8c9d0e1f";
        expect((parseText(`u"${raw}"`) as Uuid).toString()).toBe(raw);
        expect((parseText(`u'${raw}'`) as Uuid).toString()).toBe(raw);
    });
});

describe("bytes", () => {
    test("hex encoding", () => {
        const value = parseText('b"48656C6C6F"');
        expect(value).toBeInstanceOf(Uint8Array);
        expect(new TextDecoder().decode(value as Uint8Array)).toBe("Hello");
    });

    test("lowercase hex", () => {
        expect([...(parseText('b"deadbeef"') as Uint8Array)]).toEqual([0xde, 0xad, 0xbe, 0xef]);
    });

    test("empty bytes", () => {
        expect([...(parseText('b""') as Uint8Array)]).toEqual([]);
    });

    test("base64url fallback for non-hex input", () => {
        expect(parseText('b"SGVsbG8"')).toBeInstanceOf(Uint8Array);
    });
});

describe("file references", () => {
    test("bucket and key", () => {
        const value = parseText('f"bucket:/path/to/file.txt"') as FileRef;
        expect(value.bucket).toBe("bucket");
        expect(value.key).toBe("/path/to/file.txt");
    });

    test("key without leading slash gets normalised", () => {
        const value = parseText('f"bucket:file.txt"') as FileRef;
        expect(value.key).toBe("/file.txt");
    });

    test("missing colon throws", () => {
        expect(() => parseText('f"no-separator"')).toThrow(TextParseError);
    });
});

// ---------------------------------------------------------------------------
// Tables, record ids & ranges
// ---------------------------------------------------------------------------

describe("tables", () => {
    test("bare identifier", () => {
        const value = parseText("person");
        expect(value).toBeInstanceOf(Table);
        expect((value as Table).name).toBe("person");
    });

    test("backtick and angle-bracket identifiers", () => {
        expect((parseText("`my table`") as Table).name).toBe("my table");
        expect((parseText("⟨my table⟩") as Table).name).toBe("my table");
    });

    test("escaped delimiters inside identifiers", () => {
        expect((parseText("`with\\`tick`") as Table).name).toBe("with`tick");
        expect((parseText("⟨with\\⟩angle⟩") as Table).name).toBe("with⟩angle");
    });

    test("Infinity and NaN", () => {
        expect(parseText("Infinity")).toBe(Number.POSITIVE_INFINITY);
        expect(Number.isNaN(parseText("NaN") as number)).toBe(true);
    });
});

describe("record ids", () => {
    test("string key", () => {
        const value = parseText("user:tobie") as RecordId;
        expect(value.table.name).toBe("user");
        expect(value.id).toBe("tobie");
    });

    test("numeric key", () => {
        expect((parseText("user:42") as RecordId).id).toBe(42);
        expect((parseText("user:+42") as RecordId).id).toBe(42);
    });

    test("negative numeric key", () => {
        expect((parseText("temp:-5") as RecordId).id).toBe(-5);
    });

    test("bigint key", () => {
        expect((parseText("big:9007199254740992") as RecordId).id).toBe(9007199254740992n);
    });

    test("angle-bracketed digits stay a string", () => {
        expect((parseText("user:⟨123⟩") as RecordId).id).toBe("123");
    });

    test("quoted string key", () => {
        expect((parseText("user:'complex key'") as RecordId).id).toBe("complex key");
    });

    test("backtick table and key", () => {
        const value = parseText("`my table`:`the id`") as RecordId;
        expect(value.table.name).toBe("my table");
        expect(value.id).toBe("the id");
    });

    test("uuid key", () => {
        const value = parseText('user:u"01924b3c-f1a2-7e3d-a001-2f4b8c9d0e1f"') as RecordId;
        expect(value.id).toBeInstanceOf(Uuid);
    });

    test("object key", () => {
        const value = parseText("user:{ name: 'john', age: 30 }") as RecordId;
        expect(value.id).toEqual({ name: "john", age: 30 });
    });

    test("array key", () => {
        const value = parseText("temperature:['London', 2022]") as RecordId;
        expect(value.id).toEqual(["London", 2022]);
    });

    test("table names starting with a literal prefix letter", () => {
        // `d`, `u`, `s`, ... are only literal prefixes when directly followed by a quote.
        expect((parseText("device:1") as RecordId).table.name).toBe("device");
        expect((parseText("f:1") as RecordId).table.name).toBe("f");
        expect(parseText("send")).toBeInstanceOf(Table);
    });

    test("r-string record id", () => {
        const value = parseText('r"user:tobie"') as RecordId;
        expect(value.table.name).toBe("user");
        expect(value.id).toBe("tobie");
    });

    test("r-string record id range", () => {
        expect(parseText('r"user:1..5"')).toBeInstanceOf(RecordIdRange);
    });
});

describe("record id ranges", () => {
    test("exclusive end (default)", () => {
        const value = parseText("user:1..5") as RecordIdRange;
        expect(value).toBeInstanceOf(RecordIdRange);
        expect(value.begin).toEqual(new BoundIncluded(1));
        expect(value.end).toEqual(new BoundExcluded(5));
    });

    test("inclusive end", () => {
        expect((parseText("user:1..=5") as RecordIdRange).end).toEqual(new BoundIncluded(5));
    });

    test("exclusive start", () => {
        expect((parseText("user:1>..5") as RecordIdRange).begin).toEqual(new BoundExcluded(1));
    });

    test("exclusive start, inclusive end", () => {
        const value = parseText("user:1>..=5") as RecordIdRange;
        expect(value.begin).toEqual(new BoundExcluded(1));
        expect(value.end).toEqual(new BoundIncluded(5));
    });

    test("open upper bound", () => {
        const value = parseText("user:5..") as RecordIdRange;
        expect(value.begin).toEqual(new BoundIncluded(5));
        expect(value.end).toBeUndefined();
    });

    test("open lower bound", () => {
        const value = parseText("user:..5") as RecordIdRange;
        expect(value.begin).toBeUndefined();
        expect(value.end).toEqual(new BoundExcluded(5));
    });

    test("string bounds", () => {
        const value = parseText("user:'a'..'z'") as RecordIdRange;
        expect(value.begin).toEqual(new BoundIncluded("a"));
        expect(value.end).toEqual(new BoundExcluded("z"));
    });
});

describe("ranges", () => {
    test("numeric range", () => {
        const value = parseText("0..10") as Range<number, number>;
        expect(value).toBeInstanceOf(Range);
        expect(value.begin).toEqual(new BoundIncluded(0));
        expect(value.end).toEqual(new BoundExcluded(10));
    });

    test("inclusive and exclusive-start", () => {
        expect((parseText("0..=10") as Range<number, number>).end).toEqual(new BoundIncluded(10));
        expect((parseText("0>..10") as Range<number, number>).begin).toEqual(new BoundExcluded(0));
        const both = parseText("0>..=10") as Range<number, number>;
        expect(both.begin).toEqual(new BoundExcluded(0));
        expect(both.end).toEqual(new BoundIncluded(10));
    });

    test("fully unbounded", () => {
        const value = parseText("..") as Range<unknown, unknown>;
        expect(value.begin).toBeUndefined();
        expect(value.end).toBeUndefined();
    });

    test("open upper and lower bounds", () => {
        const lower = parseText("5..") as Range<number, number>;
        expect(lower.begin).toEqual(new BoundIncluded(5));
        expect(lower.end).toBeUndefined();

        const upper = parseText("..5") as Range<number, number>;
        expect(upper.begin).toBeUndefined();
        expect(upper.end).toEqual(new BoundExcluded(5));

        const upperInclusive = parseText("..=5") as Range<number, number>;
        expect(upperInclusive.end).toEqual(new BoundIncluded(5));
    });

    test("string, decimal and datetime bounds", () => {
        expect((parseText("'a'..'z'") as Range<string, string>).begin).toEqual(
            new BoundIncluded("a"),
        );
        const dec = parseText("1.5..3.5") as Range<number, number>;
        expect(dec.begin).toEqual(new BoundIncluded(1.5));
        expect(dec.end).toEqual(new BoundExcluded(3.5));
    });

    test("whitespace around the range operator", () => {
        const value = parseText("0 .. 10") as Range<number, number>;
        expect(value.begin).toEqual(new BoundIncluded(0));
        expect(value.end).toEqual(new BoundExcluded(10));
    });

    test("inclusive range with no end value throws", () => {
        expect(() => parseText("5..=")).toThrow(TextParseError);
    });
});

// ---------------------------------------------------------------------------
// Collections
// ---------------------------------------------------------------------------

describe("arrays", () => {
    test("empty and simple", () => {
        expect(parseText("[]")).toEqual([]);
        expect(parseText("[1, 2, 3]")).toEqual([1, 2, 3]);
    });

    test("mixed types", () => {
        expect(parseText("[1, 'two', true, NONE, NULL]")).toEqual([
            1,
            "two",
            true,
            undefined,
            null,
        ]);
    });

    test("trailing comma", () => {
        expect(parseText("[1, 2, 3,]")).toEqual([1, 2, 3]);
    });

    test("nested", () => {
        expect(parseText("[[1, 2], [3, [4]]]")).toEqual([
            [1, 2],
            [3, [4]],
        ]);
    });

    test("mixed value types including records and ranges", () => {
        const arr = parseText("[user:1..5, person:tobie, 0..10]") as unknown[];
        expect(arr[0]).toBeInstanceOf(RecordIdRange);
        expect(arr[1]).toBeInstanceOf(RecordId);
        expect(arr[2]).toBeInstanceOf(Range);
    });

    test("missing separator throws", () => {
        expect(() => parseText("[1 2]")).toThrow(TextParseError);
        expect(() => parseText("[1,")).toThrow(TextParseError);
    });
});

describe("objects", () => {
    test("empty object", () => {
        expect(parseText("{}")).toEqual({});
    });

    test("bare, quoted and numeric keys", () => {
        expect(parseText("{ name: 'Jane', age: 30 }")).toEqual({ name: "Jane", age: 30 });
        expect(parseText("{ 'quoted key': 1, \"other\": 2 }")).toEqual({
            "quoted key": 1,
            other: 2,
        });
        expect(parseText("{ 1: 'one' }")).toEqual({ "1": "one" });
    });

    test("dollar-prefixed (quoted) keys have no special meaning", () => {
        // Unlike the JSON codec, the text codec has no `$`-prefix escaping.
        expect(parseText("{ '$foo': 1, '$bar': 2 }")).toEqual({ $foo: 1, $bar: 2 });
    });

    test("trailing comma", () => {
        expect(parseText("{ a: 1, b: 2, }")).toEqual({ a: 1, b: 2 });
    });

    test("nested objects and arrays", () => {
        expect(parseText("{ list: [1, { deep: true }], flag: false }")).toEqual({
            list: [1, { deep: true }],
            flag: false,
        });
    });

    test("value that is itself a record id", () => {
        const value = parseText("{ owner: user:tobie }") as { owner: RecordId };
        expect(value.owner).toBeInstanceOf(RecordId);
    });

    test("missing colon or brace throws", () => {
        expect(() => parseText("{ a 1 }")).toThrow(TextParseError);
        expect(() => parseText("{ a: 1")).toThrow(TextParseError);
    });
});

describe("sets", () => {
    test("multiple elements", () => {
        const value = parseText("{ 1, 2, 3 }");
        expect(value).toBeInstanceOf(Set);
        expect([...(value as Set<number>)]).toEqual([1, 2, 3]);
    });

    test("single element", () => {
        const value = parseText("{ person }");
        expect(value).toBeInstanceOf(Set);
        expect([...(value as Set<unknown>)][0]).toBeInstanceOf(Table);
    });

    test("trailing comma", () => {
        expect([...(parseText("{ 1, 2, }") as Set<number>)]).toEqual([1, 2]);
    });

    test("de-duplicates equal primitives", () => {
        expect([...(parseText("{ 1, 1, 2 }") as Set<number>)]).toEqual([1, 2]);
    });
});

// ---------------------------------------------------------------------------
// Geometry & grouping
// ---------------------------------------------------------------------------

describe("geometry & grouping", () => {
    test("point", () => {
        const value = parseText("(-122.4194, 37.7749)");
        expect(value).toBeInstanceOf(GeometryPoint);
        expect((value as GeometryPoint).point).toEqual([-122.4194, 37.7749]);
    });

    test("point with whitespace and integer coordinates", () => {
        expect((parseText("( 1 , 2 )") as GeometryPoint).point).toEqual([1, 2]);
    });

    test("grouped expression", () => {
        expect(parseText("(42)")).toBe(42);
        expect(parseText("('hello')")).toBe("hello");
        expect(parseText("((1))")).toBe(1);
    });

    test("grouped record id", () => {
        expect(parseText("(user:tobie)")).toBeInstanceOf(RecordId);
    });

    test("three-element parenthesised list is not a point", () => {
        expect(() => parseText("(1, 2, 3)")).toThrow(TextParseError);
    });
});

// ---------------------------------------------------------------------------
// Whitespace & errors
// ---------------------------------------------------------------------------

describe("whitespace & errors", () => {
    test("tolerates surrounding whitespace and newlines", () => {
        expect(parseText("   42   ")).toBe(42);
        expect(parseText("\n\t[ 1 , 2 ]\n")).toEqual([1, 2]);
        expect(parseText("\r\n'x'\r\n")).toBe("x");
    });

    test("rejects trailing input", () => {
        expect(() => parseText("42 43")).toThrow(TextParseError);
        expect(() => parseText("[1, 2] extra")).toThrow(TextParseError);
    });

    test("rejects unterminated string", () => {
        expect(() => parseText("'oops")).toThrow(TextParseError);
    });

    test("rejects unterminated identifier", () => {
        expect(() => parseText("`oops")).toThrow(TextParseError);
        expect(() => parseText("⟨oops")).toThrow(TextParseError);
    });

    test("rejects empty or whitespace-only input", () => {
        expect(() => parseText("")).toThrow(TextParseError);
        expect(() => parseText("   ")).toThrow(TextParseError);
    });

    test("rejects a lone sign", () => {
        expect(() => parseText("+")).toThrow(TextParseError);
        expect(() => parseText("-")).toThrow(TextParseError);
    });

    test("rejects an unexpected character", () => {
        expect(() => parseText("%")).toThrow(TextParseError);
        expect(() => parseText("@")).toThrow(TextParseError);
    });

    test("rejects an empty record id key", () => {
        expect(() => parseText("user:")).toThrow(TextParseError);
    });

    test("rejects invalid unicode escape", () => {
        expect(() => parseText("'\\uZZZZ'")).toThrow(TextParseError);
        expect(() => parseText("'\\u{'")).toThrow(TextParseError);
    });

    test("error carries a character offset", () => {
        try {
            parseText("[1, 2] boom");
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

    test("parser can be used directly", () => {
        expect(new TextParser("true").parse()).toBe(true);
    });
});

describe("TextParser typed static methods", () => {
    test("each returns the expected type", () => {
        expect(TextParser.parseValue("42")).toBe(42);
        expect(TextParser.parseString("'hi'")).toBe("hi");
        expect(TextParser.parseNumber("3.14")).toBe(3.14);
        expect(TextParser.parseNumber("9007199254740992")).toBe(9007199254740992n);
        expect(TextParser.parseBool("true")).toBe(true);
        expect(TextParser.parseDecimal("3.14dec")).toBeInstanceOf(Decimal);
        expect(TextParser.parseDuration("1h30m")).toBeInstanceOf(Duration);
        expect(TextParser.parseDatetime('d"2024-01-15T09:30:00Z"')).toBeInstanceOf(DateTime);
        expect(TextParser.parseUuid('u"01924b3c-f1a2-7e3d-a001-2f4b8c9d0e1f"')).toBeInstanceOf(
            Uuid,
        );
        expect(TextParser.parseBytes('b"48656C6C6F"')).toBeInstanceOf(Uint8Array);
        expect(TextParser.parseFile('f"bucket:/f.txt"')).toBeInstanceOf(FileRef);
        expect(TextParser.parseTable("person")).toBeInstanceOf(Table);
        expect(TextParser.parseRecordId("user:tobie")).toBeInstanceOf(RecordId);
        expect(TextParser.parseRecordIdRange("user:1..5")).toBeInstanceOf(RecordIdRange);
        expect(TextParser.parseRange("0..10")).toBeInstanceOf(Range);
        expect(TextParser.parseGeometryPoint("(1, 2)")).toBeInstanceOf(GeometryPoint);
        expect(TextParser.parseArray("[1, 2]")).toEqual([1, 2]);
        expect([...TextParser.parseSet("{ 1, 2 }")]).toEqual([1, 2]);
        expect(TextParser.parseObject("{ a: 1 }")).toEqual({ a: 1 });
    });

    test("static methods honour options", () => {
        expect(
            TextParser.parseDatetime('d"2024-01-15T09:30:00Z"', { useNativeDates: true }),
        ).toBeInstanceOf(Date);
    });

    test("throw when the parsed value is the wrong type", () => {
        expect(() => TextParser.parseArray("42")).toThrow(TextParseError);
        expect(() => TextParser.parseRecordId("user:1..5")).toThrow(TextParseError);
        expect(() => TextParser.parseObject("{ 1, 2 }")).toThrow(TextParseError);
        expect(() => TextParser.parseNumber("'not a number'")).toThrow(TextParseError);
        expect(() => TextParser.parseTable("user:1")).toThrow(TextParseError);
    });

    test("still enforce full-input consumption", () => {
        expect(() => TextParser.parseArray("[1, 2] extra")).toThrow(TextParseError);
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
