import { describe, expect, test } from "bun:test";
import {
    BoundExcluded,
    BoundIncluded,
    DateTime,
    Decimal,
    Duration,
    FileRef,
    Future,
    GeometryCollection,
    GeometryLine,
    GeometryMultiLine,
    GeometryMultiPoint,
    GeometryMultiPolygon,
    GeometryPoint,
    GeometryPolygon,
    JsonCodec,
    Range,
    RecordId,
    RecordIdRange,
    StringRecordId,
    Table,
    Uuid,
} from "surrealdb";

const codec = new JsonCodec({});

function roundTrip<T>(value: T): unknown {
    return codec.decode(codec.encode(value));
}

describe("JsonCodec", () => {
    describe("primitives", () => {
        test("null", () => {
            expect(codec.encode(null)).toBeNull();
            expect(roundTrip(null)).toBeNull();
        });

        test("boolean", () => {
            expect(codec.encode(true)).toBe(true);
            expect(codec.encode(false)).toBe(false);
            expect(roundTrip(true)).toBe(true);
            expect(roundTrip(false)).toBe(false);
        });

        test("string", () => {
            expect(codec.encode("hello")).toBe("hello");
            expect(roundTrip("hello")).toBe("hello");
        });

        test("number", () => {
            expect(codec.encode(42)).toBe(42);
            expect(codec.encode(3.14)).toBe(3.14);
            expect(roundTrip(42)).toBe(42);
        });

        test("bigint", () => {
            expect(codec.encode(123n)).toBe(123n);
            expect(roundTrip(123n)).toBe(123n);
        });
    });

    describe("none", () => {
        test("encode", () => {
            expect(codec.encode(undefined)).toEqual({ $none: true });
        });

        test("decode", () => {
            expect(codec.decode({ $none: true })).toBeUndefined();
        });
    });

    describe("DateTime", () => {
        test("encode", () => {
            const dt = new DateTime("2024-01-15T10:30:00Z");
            const encoded = codec.encode(dt);
            expect(encoded).toEqual({ $datetime: "2024-01-15T10:30:00.000Z" });
        });

        test("round-trip", () => {
            const dt = new DateTime("2024-06-15T12:00:00Z");
            const result = roundTrip(dt);
            expect(result).toBeInstanceOf(DateTime);
            expect((result as DateTime).toISOString()).toBe(dt.toISOString());
        });

        test("native Date encode", () => {
            const date = new Date("2024-03-01T00:00:00.000Z");
            const encoded = codec.encode(date);
            expect(encoded).toEqual({ $datetime: "2024-03-01T00:00:00.000Z" });
        });

        test("useNativeDates option", () => {
            const nativeCodec = new JsonCodec({ useNativeDates: true });
            const encoded = { $datetime: "2024-01-01T00:00:00Z" };
            const result = nativeCodec.decode(encoded);
            expect(result).toBeInstanceOf(Date);
        });
    });

    describe("Decimal", () => {
        test("encode", () => {
            const d = new Decimal("3.14159");
            expect(codec.encode(d)).toEqual({ $decimal: "3.14159" });
        });

        test("round-trip", () => {
            const d = new Decimal("123456789.987654321");
            const result = roundTrip(d);
            expect(result).toBeInstanceOf(Decimal);
            expect((result as Decimal).toString()).toBe("123456789.987654321");
        });
    });

    describe("Duration", () => {
        test("encode", () => {
            const d = new Duration("1h30m");
            expect(codec.encode(d)).toEqual({ $duration: d.toString() });
        });

        test("round-trip", () => {
            const d = new Duration("2d12h30m15s");
            const result = roundTrip(d);
            expect(result).toBeInstanceOf(Duration);
            expect((result as Duration).toString()).toBe(d.toString());
        });
    });

    describe("Uuid", () => {
        test("encode", () => {
            const uuid = new Uuid("d2f72714-a387-487a-8eae-451330796ff4");
            expect(codec.encode(uuid)).toEqual({
                $uuid: "d2f72714-a387-487a-8eae-451330796ff4",
            });
        });

        test("round-trip", () => {
            const uuid = new Uuid("d2f72714-a387-487a-8eae-451330796ff4");
            const result = roundTrip(uuid);
            expect(result).toBeInstanceOf(Uuid);
            expect((result as Uuid).toString()).toBe(uuid.toString());
        });
    });

    describe("RecordId", () => {
        test("encode with string id", () => {
            const rid = new RecordId("users", "bob");
            expect(codec.encode(rid)).toEqual({
                $recordId: { tb: "users", id: "bob" },
            });
        });

        test("encode with numeric id", () => {
            const rid = new RecordId("users", 42);
            expect(codec.encode(rid)).toEqual({
                $recordId: { tb: "users", id: 42 },
            });
        });

        test("encode with object id", () => {
            const rid = new RecordId("events", { city: "London", year: 2024 });
            const encoded = codec.encode(rid) as { $recordId: { tb: string; id: unknown } };
            expect(encoded.$recordId.tb).toBe("events");
            expect(encoded.$recordId.id).toEqual({ city: "London", year: 2024 });
        });

        test("encode with array id", () => {
            const rid = new RecordId("matrix", ["a", "b"]);
            const encoded = codec.encode(rid) as { $recordId: { tb: string; id: unknown } };
            expect(encoded.$recordId.tb).toBe("matrix");
            expect(encoded.$recordId.id).toEqual(["a", "b"]);
        });

        test("round-trip with string id", () => {
            const rid = new RecordId("users", "bob");
            const result = roundTrip(rid);
            expect(result).toBeInstanceOf(RecordId);
            expect((result as RecordId).table.name).toBe("users");
        });

        test("round-trip with numeric id", () => {
            const rid = new RecordId("users", 42);
            const result = roundTrip(rid);
            expect(result).toBeInstanceOf(RecordId);
            expect((result as RecordId).table.name).toBe("users");
        });
    });

    describe("StringRecordId", () => {
        test("encode", () => {
            const srid = new StringRecordId("users:bob");
            expect(codec.encode(srid)).toEqual({ $recordIdString: "users:bob" });
        });

        test("round-trip", () => {
            const srid = new StringRecordId("users:bob");
            const result = roundTrip(srid);
            expect(result).toBeInstanceOf(StringRecordId);
            expect((result as StringRecordId).toString()).toBe("users:bob");
        });
    });

    describe("RecordIdRange", () => {
        test("encode", () => {
            const range = new RecordIdRange("users", new BoundIncluded(1), new BoundExcluded(100));
            expect(codec.encode(range)).toEqual({
                $recordId: {
                    tb: "users",
                    id: {
                        $range: {
                            begin: { $boundIncluded: 1 },
                            end: { $boundExcluded: 100 },
                        },
                    },
                },
            });
        });

        test("round-trip", () => {
            const range = new RecordIdRange("users", new BoundIncluded(1), new BoundExcluded(100));
            const result = roundTrip(range);
            expect(result).toBeInstanceOf(RecordIdRange);
            const decoded = result as RecordIdRange;
            expect(decoded.table.name).toBe("users");
            expect(decoded.begin).toBeInstanceOf(BoundIncluded);
            expect(decoded.begin?.value).toBe(1);
            expect(decoded.end).toBeInstanceOf(BoundExcluded);
            expect(decoded.end?.value).toBe(100);
        });
    });

    describe("Table", () => {
        test("encode", () => {
            expect(codec.encode(new Table("users"))).toEqual({ $table: "users" });
        });

        test("round-trip", () => {
            const result = roundTrip(new Table("users"));
            expect(result).toBeInstanceOf(Table);
            expect((result as Table).name).toBe("users");
        });
    });

    describe("Range", () => {
        test("encode with both bounds", () => {
            const range = new Range(new BoundIncluded(1), new BoundExcluded(10));
            expect(codec.encode(range)).toEqual({
                $range: {
                    begin: { $boundIncluded: 1 },
                    end: { $boundExcluded: 10 },
                },
            });
        });

        test("encode with undefined bounds", () => {
            const range = new Range(undefined, new BoundIncluded(10));
            expect(codec.encode(range)).toEqual({
                $range: {
                    begin: null,
                    end: { $boundIncluded: 10 },
                },
            });
        });

        test("round-trip", () => {
            const range = new Range(new BoundIncluded(5), new BoundExcluded(50));
            const result = roundTrip(range);
            expect(result).toBeInstanceOf(Range);
            const decoded = result as Range<number, number>;
            expect(decoded.begin).toBeInstanceOf(BoundIncluded);
            expect(decoded.begin?.value).toBe(5);
            expect(decoded.end).toBeInstanceOf(BoundExcluded);
            expect(decoded.end?.value).toBe(50);
        });
    });

    describe("FileRef", () => {
        test("encode", () => {
            const file = new FileRef("images", "/avatar.png");
            expect(codec.encode(file)).toEqual({
                $file: { bucket: "images", key: "/avatar.png" },
            });
        });

        test("round-trip", () => {
            const file = new FileRef("docs", "/report.pdf");
            const result = roundTrip(file);
            expect(result).toBeInstanceOf(FileRef);
            expect((result as FileRef).bucket).toBe("docs");
            expect((result as FileRef).key).toBe("/report.pdf");
        });
    });

    describe("Future", () => {
        test("encode", () => {
            const future = new Future("{ RETURN 42 }");
            expect(codec.encode(future)).toEqual({ $future: "{ RETURN 42 }" });
        });

        test("round-trip", () => {
            const future = new Future("{ time::now() }");
            const result = roundTrip(future);
            expect(result).toBeInstanceOf(Future);
            expect((result as Future).body).toBe("{ time::now() }");
        });
    });

    describe("Uint8Array", () => {
        test("encode", () => {
            const bytes = new Uint8Array([72, 101, 108, 108, 111]);
            const encoded = codec.encode(bytes) as { $bytes: string };
            expect(encoded.$bytes).toBeTypeOf("string");
        });

        test("round-trip", () => {
            const bytes = new Uint8Array([0, 1, 2, 255]);
            const result = roundTrip(bytes);
            expect(result).toBeInstanceOf(Uint8Array);
            expect(result).toEqual(bytes);
        });
    });

    describe("Geometry", () => {
        test("encode Point", () => {
            const point = new GeometryPoint([1.5, 2.5]);
            expect(codec.encode(point)).toEqual({
                $geometry: { type: "Point", coordinates: [1.5, 2.5] },
            });
        });

        test("round-trip Point", () => {
            const point = new GeometryPoint([10, 20]);
            const result = roundTrip(point);
            expect(result).toBeInstanceOf(GeometryPoint);
            expect((result as GeometryPoint).point).toEqual([10, 20]);
        });

        test("round-trip LineString", () => {
            const line = new GeometryLine([new GeometryPoint([0, 0]), new GeometryPoint([1, 1])]);
            const result = roundTrip(line);
            expect(result).toBeInstanceOf(GeometryLine);
            const decoded = result as GeometryLine;
            expect(decoded.line).toHaveLength(2);
            expect(decoded.line[0].point).toEqual([0, 0]);
            expect(decoded.line[1].point).toEqual([1, 1]);
        });

        test("round-trip Polygon", () => {
            const poly = new GeometryPolygon([
                new GeometryLine([
                    new GeometryPoint([0, 0]),
                    new GeometryPoint([1, 0]),
                    new GeometryPoint([1, 1]),
                    new GeometryPoint([0, 0]),
                ]),
            ]);
            const result = roundTrip(poly);
            expect(result).toBeInstanceOf(GeometryPolygon);
        });

        test("round-trip MultiPoint", () => {
            const mp = new GeometryMultiPoint([
                new GeometryPoint([0, 0]),
                new GeometryPoint([1, 1]),
            ]);
            const result = roundTrip(mp);
            expect(result).toBeInstanceOf(GeometryMultiPoint);
            expect((result as GeometryMultiPoint).points).toHaveLength(2);
        });

        test("round-trip MultiLineString", () => {
            const ml = new GeometryMultiLine([
                new GeometryLine([new GeometryPoint([0, 0]), new GeometryPoint([1, 1])]),
            ]);
            const result = roundTrip(ml);
            expect(result).toBeInstanceOf(GeometryMultiLine);
        });

        test("round-trip MultiPolygon", () => {
            const mpoly = new GeometryMultiPolygon([
                new GeometryPolygon([
                    new GeometryLine([
                        new GeometryPoint([0, 0]),
                        new GeometryPoint([1, 0]),
                        new GeometryPoint([1, 1]),
                        new GeometryPoint([0, 0]),
                    ]),
                ]),
            ]);
            const result = roundTrip(mpoly);
            expect(result).toBeInstanceOf(GeometryMultiPolygon);
        });

        test("round-trip GeometryCollection", () => {
            const coll = new GeometryCollection([
                new GeometryPoint([1, 2]),
                new GeometryLine([new GeometryPoint([0, 0]), new GeometryPoint([3, 3])]),
            ]);
            const result = roundTrip(coll);
            expect(result).toBeInstanceOf(GeometryCollection);
            const decoded = result as GeometryCollection;
            expect(decoded.collection).toHaveLength(2);
            expect(decoded.collection[0]).toBeInstanceOf(GeometryPoint);
            expect(decoded.collection[1]).toBeInstanceOf(GeometryLine);
        });
    });

    describe("Set", () => {
        test("encode", () => {
            const s = new Set([1, 2, 3]);
            expect(codec.encode(s)).toEqual({ $set: [1, 2, 3] });
        });

        test("round-trip", () => {
            const s = new Set(["a", "b", "c"]);
            const result = roundTrip(s);
            expect(result).toBeInstanceOf(Set);
            expect(result).toEqual(new Set(["a", "b", "c"]));
        });

        test("round-trip with nested values", () => {
            const s = new Set([new Decimal("1.5"), new Decimal("2.5")]);
            const result = roundTrip(s) as Set<unknown>;
            expect(result).toBeInstanceOf(Set);
            expect(result.size).toBe(2);
            for (const v of result) {
                expect(v).toBeInstanceOf(Decimal);
            }
        });
    });

    describe("containers", () => {
        test("array", () => {
            const arr = [1, "two", new Decimal("3")];
            const result = roundTrip(arr) as unknown[];
            expect(result[0]).toBe(1);
            expect(result[1]).toBe("two");
            expect(result[2]).toBeInstanceOf(Decimal);
        });

        test("object", () => {
            const obj = { name: "Alice", age: 30 };
            expect(roundTrip(obj)).toEqual({ name: "Alice", age: 30 });
        });

        test("nested values in objects", () => {
            const obj = {
                id: new RecordId("users", "alice"),
                created: new DateTime("2024-01-01T00:00:00Z"),
            };
            const result = roundTrip(obj) as Record<string, unknown>;
            expect(result.id).toBeInstanceOf(RecordId);
            expect(result.created).toBeInstanceOf(DateTime);
        });

        test("Map", () => {
            const map = new Map<string, unknown>([
                ["key1", 1],
                ["key2", "value"],
            ]);
            const result = roundTrip(map);
            expect(result).toEqual({ key1: 1, key2: "value" });
        });
    });

    describe("explicit objects", () => {
        test("encode wraps objects with $-prefixed keys", () => {
            const obj = { $foo: "bar", $baz: 42 };
            expect(codec.encode(obj)).toEqual({
                $object: { $foo: "bar", $baz: 42 },
            });
        });

        test("encode does not wrap objects without $-prefixed keys", () => {
            const obj = { name: "Alice", age: 30 };
            expect(codec.encode(obj)).toEqual({ name: "Alice", age: 30 });
        });

        test("decode unwraps $object to plain object", () => {
            const input = { $object: { $foo: "bar" } };
            expect(codec.decode<{ $foo: string }>(input)).toEqual({ $foo: "bar" });
        });

        test("round-trip preserves $-prefixed keys", () => {
            const obj = { $foo: "bar", regular: "value" };
            const result = roundTrip(obj);
            expect(result).toEqual({ $foo: "bar", regular: "value" });
        });

        test("nested SQON values inside $object are still deserialized", () => {
            const input = {
                $object: {
                    $custom: { $datetime: "2024-01-15T10:30:00.000Z" },
                },
            };
            const result = codec.decode(input) as Record<string, unknown>;
            expect(result.$custom).toBeInstanceOf(DateTime);
        });

        test("encode wraps when only some keys are $-prefixed", () => {
            const obj = { $meta: true, name: "test" };
            expect(codec.encode(obj)).toEqual({
                $object: { $meta: true, name: "test" },
            });
        });

        test("round-trip with nested objects containing $-prefixed keys", () => {
            const obj = {
                outer: { $inner: "value" },
            };
            const result = roundTrip(obj) as Record<string, unknown>;
            expect(result.outer).toEqual({ $inner: "value" });
        });
    });

    describe("visitors", () => {
        test("valueEncodeVisitor", () => {
            const visitor = new JsonCodec({
                valueEncodeVisitor: (v) => {
                    if (typeof v === "string") return v.toUpperCase();
                    return v;
                },
            });

            expect(visitor.encode("hello")).toBe("HELLO");
        });

        test("valueDecodeVisitor", () => {
            const visitor = new JsonCodec({
                valueDecodeVisitor: (v) => {
                    if (v instanceof Table) return v.name;
                    return v;
                },
            });

            expect(visitor.decode<string>({ $table: "users" })).toBe("users");
        });
    });
});
