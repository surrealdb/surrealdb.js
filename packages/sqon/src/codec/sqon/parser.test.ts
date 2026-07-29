import { describe, expect, test } from "bun:test";
import { SqonParseError } from "../../errors.ts";
import { BoundExcluded, BoundIncluded } from "../../utils/range.ts";
import { toSurqlString } from "../../utils/to-surql-string.ts";
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
import { parseSqon } from "./parser.ts";

describe("primitives", () => {
    test("none / null / bool", () => {
        expect(parseSqon("NONE")).toBeUndefined();
        expect(parseSqon("none")).toBeUndefined();
        expect(parseSqon("NULL")).toBeNull();
        expect(parseSqon("true")).toBe(true);
        expect(parseSqon("false")).toBe(false);
    });

    test("integers", () => {
        expect(parseSqon("42")).toBe(42);
        expect(parseSqon("-42")).toBe(-42);
        expect(parseSqon("+7")).toBe(7);
        expect(parseSqon("0")).toBe(0);
        expect(parseSqon("1_000_000")).toBe(1000000);
    });

    test("large integers become bigint", () => {
        expect(parseSqon("9007199254740993")).toBe(9007199254740993n);
        expect(parseSqon("-9007199254740993")).toBe(-9007199254740993n);
    });

    test("floats", () => {
        expect(parseSqon("3.14")).toBe(3.14);
        expect(parseSqon("3.14f")).toBe(3.14);
        expect(parseSqon("42f")).toBe(42);
        expect(parseSqon("1e3")).toBe(1000);
        expect(parseSqon("1.5e-2")).toBe(0.015);
        expect(parseSqon("-0.5")).toBe(-0.5);
    });

    test("decimals", () => {
        const value = parseSqon("3.14159265358979dec");
        expect(value).toBeInstanceOf(Decimal);
        expect((value as Decimal).toString()).toBe("3.14159265358979");
    });

    test("strings", () => {
        expect(parseSqon("'hello'")).toBe("hello");
        expect(parseSqon('"hello"')).toBe("hello");
        expect(parseSqon('s"hello"')).toBe("hello");
        expect(parseSqon("s'hello'")).toBe("hello");
        expect(parseSqon("'with \\'escape\\''")).toBe("with 'escape'");
        expect(parseSqon('"tab\\tnewline\\n"')).toBe("tab\tnewline\n");
        expect(parseSqon("'unicode \\u0041 \\u{1F600}'")).toBe("unicode A 😀");
    });
});

describe("surrealdb-specific scalars", () => {
    test("duration", () => {
        const value = parseSqon("1h30m");
        expect(value).toBeInstanceOf(Duration);
        expect((value as Duration).toString()).toBe("1h30m");
        expect((parseSqon("100ms") as Duration).toString()).toBe("100ms");
        expect((parseSqon("1y2w3d4h5m6s7ms8us9ns") as Duration).toString()).toBe(
            "1y2w3d4h5m6s7ms8us9ns",
        );
    });

    test("datetime", () => {
        const value = parseSqon('d"2024-01-15T09:30:00Z"');
        expect(value).toBeInstanceOf(DateTime);
        expect((value as DateTime).toISOString()).toBe("2024-01-15T09:30:00.000Z");
    });

    test("datetime with useNativeDates", () => {
        const value = parseSqon('d"2024-01-15T09:30:00Z"', { useNativeDates: true });
        expect(value).toBeInstanceOf(Date);
    });

    test("uuid", () => {
        const raw = "01924b3c-f1a2-7e3d-a001-2f4b8c9d0e1f";
        const value = parseSqon(`u"${raw}"`);
        expect(value).toBeInstanceOf(Uuid);
        expect((value as Uuid).toString()).toBe(raw);
    });

    test("bytes (hex)", () => {
        const value = parseSqon('b"48656C6C6F"');
        expect(value).toBeInstanceOf(Uint8Array);
        expect(new TextDecoder().decode(value as Uint8Array)).toBe("Hello");
    });

    test("file reference", () => {
        const value = parseSqon('f"bucket:/path/to/file.txt"');
        expect(value).toBeInstanceOf(FileRef);
        expect((value as FileRef).bucket).toBe("bucket");
        expect((value as FileRef).key).toBe("/path/to/file.txt");
    });
});

describe("tables & record ids", () => {
    test("bare table", () => {
        const value = parseSqon("person");
        expect(value).toBeInstanceOf(Table);
        expect((value as Table).name).toBe("person");
    });

    test("string record id", () => {
        const value = parseSqon("user:tobie");
        expect(value).toBeInstanceOf(RecordId);
        expect((value as RecordId).table.name).toBe("user");
        expect((value as RecordId).id).toBe("tobie");
    });

    test("numeric record id", () => {
        const value = parseSqon("user:42") as RecordId;
        expect(value.id).toBe(42);
    });

    test("angle-bracket record id keeps digits as string", () => {
        const value = parseSqon("user:⟨123⟩") as RecordId;
        expect(value.id).toBe("123");
    });

    test("backtick table and id", () => {
        const value = parseSqon("`my table`:`the id`") as RecordId;
        expect(value.table.name).toBe("my table");
        expect(value.id).toBe("the id");
    });

    test("object record id", () => {
        const value = parseSqon("user:{ name: 'john', age: 30 }") as RecordId;
        expect(value.id).toEqual({ name: "john", age: 30 });
    });

    test("array record id", () => {
        const value = parseSqon("temperature:['London', 42]") as RecordId;
        expect(value.id).toEqual(["London", 42]);
    });

    test("uuid record id", () => {
        const raw = "01924b3c-f1a2-7e3d-a001-2f4b8c9d0e1f";
        const value = parseSqon(`user:u"${raw}"`) as RecordId;
        expect(value.id).toBeInstanceOf(Uuid);
    });

    test("r-string record id", () => {
        const value = parseSqon('r"user:tobie"');
        expect(value).toBeInstanceOf(RecordId);
        expect((value as RecordId).id).toBe("tobie");
    });
});

describe("record id ranges", () => {
    test("inclusive/exclusive bounds", () => {
        const value = parseSqon("user:1..5") as RecordIdRange;
        expect(value).toBeInstanceOf(RecordIdRange);
        expect(value.begin).toEqual(new BoundIncluded(1));
        expect(value.end).toEqual(new BoundExcluded(5));
    });

    test("inclusive end", () => {
        const value = parseSqon("user:1..=5") as RecordIdRange;
        expect(value.end).toEqual(new BoundIncluded(5));
    });

    test("exclusive start", () => {
        const value = parseSqon("user:1>..5") as RecordIdRange;
        expect(value.begin).toEqual(new BoundExcluded(1));
    });

    test("open bounds", () => {
        const lower = parseSqon("user:1..") as RecordIdRange;
        expect(lower.begin).toEqual(new BoundIncluded(1));
        expect(lower.end).toBeUndefined();

        const upper = parseSqon("user:..5") as RecordIdRange;
        expect(upper.begin).toBeUndefined();
        expect(upper.end).toEqual(new BoundExcluded(5));
    });
});

describe("ranges", () => {
    test("numeric range", () => {
        const value = parseSqon("0..10") as Range<number, number>;
        expect(value).toBeInstanceOf(Range);
        expect(value.begin).toEqual(new BoundIncluded(0));
        expect(value.end).toEqual(new BoundExcluded(10));
    });

    test("inclusive and exclusive-start ranges", () => {
        expect((parseSqon("0..=10") as Range<number, number>).end).toEqual(new BoundIncluded(10));
        expect((parseSqon("0>..10") as Range<number, number>).begin).toEqual(new BoundExcluded(0));
    });

    test("unbounded ranges", () => {
        const full = parseSqon("..") as Range<unknown, unknown>;
        expect(full.begin).toBeUndefined();
        expect(full.end).toBeUndefined();

        const lower = parseSqon("5..") as Range<number, number>;
        expect(lower.begin).toEqual(new BoundIncluded(5));
        expect(lower.end).toBeUndefined();
    });
});

describe("collections", () => {
    test("arrays", () => {
        expect(parseSqon("[1, 2, 3]")).toEqual([1, 2, 3]);
        expect(parseSqon("[]")).toEqual([]);
        expect(parseSqon("[1, 'two', true, NONE]")).toEqual([1, "two", true, undefined]);
        expect(parseSqon("[1, 2, 3,]")).toEqual([1, 2, 3]);
    });

    test("nested arrays", () => {
        expect(parseSqon("[[1, 2], [3, 4]]")).toEqual([
            [1, 2],
            [3, 4],
        ]);
    });

    test("objects", () => {
        expect(parseSqon("{ name: 'Jane', age: 30 }")).toEqual({ name: "Jane", age: 30 });
        expect(parseSqon("{}")).toEqual({});
        expect(parseSqon("{ 'quoted key': 1, \"other\": 2 }")).toEqual({
            "quoted key": 1,
            other: 2,
        });
        expect(parseSqon("{ 1: 'one' }")).toEqual({ "1": "one" });
    });

    test("nested objects and arrays", () => {
        expect(parseSqon("{ list: [1, { deep: true }], flag: false }")).toEqual({
            list: [1, { deep: true }],
            flag: false,
        });
    });

    test("sets", () => {
        const value = parseSqon("{ 1, 2, 3 }");
        expect(value).toBeInstanceOf(Set);
        expect([...(value as Set<number>)]).toEqual([1, 2, 3]);
    });

    test("set with single element", () => {
        const value = parseSqon("{ person }");
        expect(value).toBeInstanceOf(Set);
        const items = [...(value as Set<unknown>)];
        expect(items[0]).toBeInstanceOf(Table);
    });
});

describe("geometry", () => {
    test("point", () => {
        const value = parseSqon("(-122.4194, 37.7749)");
        expect(value).toBeInstanceOf(GeometryPoint);
        expect((value as GeometryPoint).point).toEqual([-122.4194, 37.7749]);
    });

    test("grouped expression", () => {
        expect(parseSqon("(42)")).toBe(42);
        expect(parseSqon("('hello')")).toBe("hello");
    });
});

describe("whitespace & errors", () => {
    test("tolerates surrounding whitespace", () => {
        expect(parseSqon("   42   ")).toBe(42);
        expect(parseSqon("\n\t[ 1 , 2 ]\n")).toEqual([1, 2]);
    });

    test("rejects trailing input", () => {
        expect(() => parseSqon("42 43")).toThrow(SqonParseError);
    });

    test("rejects unterminated string", () => {
        expect(() => parseSqon("'oops")).toThrow(SqonParseError);
    });

    test("rejects empty input", () => {
        expect(() => parseSqon("   ")).toThrow(SqonParseError);
    });
});

describe("round-trips with toSurqlString", () => {
    const cases: unknown[] = [
        42,
        -17,
        3.14,
        "hello world",
        true,
        false,
        null,
        undefined,
        [1, 2, 3],
        { name: "Jane", age: 30 },
        new Decimal("3.14159"),
        new Duration("1h30m"),
        new Uuid("01924b3c-f1a2-7e3d-a001-2f4b8c9d0e1f"),
        new Table("person"),
        new RecordId("user", "tobie"),
        new RecordId("user", 42),
        new RecordIdRange("user", new BoundIncluded(1), new BoundExcluded(5)),
        new Range(new BoundIncluded(0), new BoundExcluded(10)),
    ];

    for (const value of cases) {
        test(`round-trips ${toSurqlString(value)}`, () => {
            const encoded = toSurqlString(value);
            const decoded = parseSqon(encoded);
            const reencoded = toSurqlString(decoded);
            expect(reencoded).toBe(encoded);
        });
    }
});
