import { describe, expect, test } from "bun:test";
import {
    BoundExcluded,
    BoundIncluded,
    CborCodec,
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
    Range,
    RecordId,
    RecordIdRange,
    StringRecordId,
    Table,
    Uuid,
} from "surrealdb";

const codec = new CborCodec({});

function roundTrip<T>(value: T): unknown {
    return codec.decode(codec.encode(value));
}

describe("CborCodec", () => {
    describe("primitives", () => {
        test("null", () => {
            expect(roundTrip(null)).toBeNull();
        });

        test("boolean", () => {
            expect(roundTrip(true)).toBe(true);
            expect(roundTrip(false)).toBe(false);
        });

        test("string", () => {
            expect(roundTrip("hello")).toBe("hello");
        });

        test("number", () => {
            expect(roundTrip(42)).toBe(42);
            expect(roundTrip(3.14)).toBe(3.14);
            expect(roundTrip(-100)).toBe(-100);
        });

        test("bigint", () => {
            const encoded = codec.encode(123n);
            expect(encoded).toBeInstanceOf(Uint8Array);
            expect(codec.decode(encoded)).toBe(123);
        });
    });

    describe("none", () => {
        test("round-trip", () => {
            expect(roundTrip(undefined)).toBeUndefined();
        });
    });

    describe("DateTime", () => {
        test("round-trip", () => {
            const dt = new DateTime("2024-06-15T12:30:45Z");
            const result = roundTrip(dt);
            expect(result).toBeInstanceOf(DateTime);
            expect((result as DateTime).toISOString()).toBe(dt.toISOString());
        });

        test("native Date round-trip", () => {
            const date = new Date("2024-03-01T00:00:00.000Z");
            const result = roundTrip(date);
            expect(result).toBeInstanceOf(DateTime);
        });

        test("useNativeDates option", () => {
            const nativeCodec = new CborCodec({ useNativeDates: true });
            const dt = new DateTime("2024-01-01T00:00:00Z");
            const encoded = nativeCodec.encode(dt);
            const result = nativeCodec.decode(encoded);
            expect(result).toBeInstanceOf(Date);
        });
    });

    describe("Decimal", () => {
        test("round-trip", () => {
            const d = new Decimal("123456789.987654321");
            const result = roundTrip(d);
            expect(result).toBeInstanceOf(Decimal);
            expect((result as Decimal).toString()).toBe("123456789.987654321");
        });
    });

    describe("Duration", () => {
        test("round-trip", () => {
            const d = new Duration("2d12h30m15s");
            const result = roundTrip(d);
            expect(result).toBeInstanceOf(Duration);
            expect((result as Duration).toString()).toBe(d.toString());
        });
    });

    describe("Uuid", () => {
        test("round-trip", () => {
            const uuid = new Uuid("d2f72714-a387-487a-8eae-451330796ff4");
            const result = roundTrip(uuid);
            expect(result).toBeInstanceOf(Uuid);
            expect((result as Uuid).toString()).toBe("d2f72714-a387-487a-8eae-451330796ff4");
        });
    });

    describe("RecordId", () => {
        test("round-trip with string id", () => {
            const rid = new RecordId("users", "bob");
            const result = roundTrip(rid);
            expect(result).toBeInstanceOf(RecordId);
            const decoded = result as RecordId;
            expect(decoded.table.name).toBe("users");
        });

        test("round-trip with numeric id", () => {
            const rid = new RecordId("users", 42);
            const result = roundTrip(rid);
            expect(result).toBeInstanceOf(RecordId);
            const decoded = result as RecordId;
            expect(decoded.table.name).toBe("users");
        });

        test("round-trip with array id", () => {
            const rid = new RecordId("matrix", ["a", "b"]);
            const result = roundTrip(rid);
            expect(result).toBeInstanceOf(RecordId);
        });

        test("round-trip with object id", () => {
            const rid = new RecordId("events", { city: "London", year: 2024 });
            const result = roundTrip(rid);
            expect(result).toBeInstanceOf(RecordId);
        });
    });

    describe("StringRecordId", () => {
        test("round-trip", () => {
            const srid = new StringRecordId("users:bob");
            const result = roundTrip(srid);
            expect(result).toBeInstanceOf(StringRecordId);
            expect((result as StringRecordId).toString()).toBe("users:bob");
        });
    });

    describe("RecordIdRange", () => {
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
        test("round-trip", () => {
            const result = roundTrip(new Table("users"));
            expect(result).toBeInstanceOf(Table);
            expect((result as Table).name).toBe("users");
        });
    });

    describe("Range", () => {
        test("round-trip with both bounds", () => {
            const range = new Range(new BoundIncluded(5), new BoundExcluded(50));
            const result = roundTrip(range);
            expect(result).toBeInstanceOf(Range);
            const decoded = result as Range<number, number>;
            expect(decoded.begin).toBeInstanceOf(BoundIncluded);
            expect(decoded.begin?.value).toBe(5);
            expect(decoded.end).toBeInstanceOf(BoundExcluded);
            expect(decoded.end?.value).toBe(50);
        });

        test("round-trip with unbounded begin", () => {
            const range = new Range(undefined, new BoundIncluded(10));
            const result = roundTrip(range);
            expect(result).toBeInstanceOf(Range);
            const decoded = result as Range<unknown, number>;
            expect(decoded.begin).toBeUndefined();
            expect(decoded.end).toBeInstanceOf(BoundIncluded);
            expect(decoded.end?.value).toBe(10);
        });
    });

    describe("FileRef", () => {
        test("round-trip", () => {
            const file = new FileRef("images", "/avatar.png");
            const result = roundTrip(file);
            expect(result).toBeInstanceOf(FileRef);
            expect((result as FileRef).bucket).toBe("images");
            expect((result as FileRef).key).toBe("/avatar.png");
        });
    });

    describe("Future", () => {
        test("round-trip", () => {
            const future = new Future("{ time::now() }");
            const result = roundTrip(future);
            expect(result).toBeInstanceOf(Future);
            expect((result as Future).body).toBe("{ time::now() }");
        });
    });

    describe("Uint8Array", () => {
        test("round-trip preserves binary data", () => {
            const bytes = new Uint8Array([0, 1, 2, 255]);
            const result = roundTrip(bytes);
            const decoded = result instanceof Uint8Array ? result : new Uint8Array(result as ArrayBuffer);
            expect(decoded).toEqual(bytes);
        });
    });

    describe("Set", () => {
        test("round-trip", () => {
            const s = new Set([1, 2, 3]);
            const result = roundTrip(s);
            expect(result).toBeInstanceOf(Set);
            expect(result).toEqual(new Set([1, 2, 3]));
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

    describe("Geometry", () => {
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

    describe("containers", () => {
        test("array round-trip", () => {
            const arr = [1, "two", new Decimal("3")];
            const result = roundTrip(arr) as unknown[];
            expect(result[0]).toBe(1);
            expect(result[1]).toBe("two");
            expect(result[2]).toBeInstanceOf(Decimal);
        });

        test("object round-trip", () => {
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

    describe("visitors", () => {
        test("valueEncodeVisitor", () => {
            const visitor = new CborCodec({
                valueEncodeVisitor: (v) => {
                    if (typeof v === "string") return v.toUpperCase();
                    return v;
                },
            });

            expect(visitor.decode<string>(visitor.encode("hello"))).toBe("HELLO");
        });

        test("valueDecodeVisitor", () => {
            const visitor = new CborCodec({
                valueDecodeVisitor: (v) => {
                    if (v instanceof Table) return v.name;
                    return v;
                },
            });

            const encoded = visitor.encode(new Table("users"));
            expect(visitor.decode<string>(encoded)).toBe("users");
        });
    });
});
