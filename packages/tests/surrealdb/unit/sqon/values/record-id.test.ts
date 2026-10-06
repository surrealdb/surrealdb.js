import { describe, expect, test } from "bun:test";
import { Decimal, RecordId, Uuid } from "surrealdb";

describe("record ids", () => {
    test("valid id part", () => {
        expect(() => new RecordId("table", "b")).not.toThrow();
        expect(() => new RecordId("table", 123)).not.toThrow();
        expect(() => new RecordId("table", 9223372036854775807n)).not.toThrow();
        expect(
            () => new RecordId("table", new Uuid("d2f72714-a387-487a-8eae-451330796ff4")),
        ).not.toThrow();
        expect(() => new RecordId("table", ["a", "b", "c"])).not.toThrow();
        expect(() => new RecordId("table", { a: 1, b: 2, c: 3 })).not.toThrow();
        // @ts-expect-error
        expect(() => new RecordId("table", null)).toThrow();
        // @ts-expect-error
        expect(() => new RecordId("table", undefined)).toThrow();
        // @ts-expect-error
        expect(() => new RecordId("table", new Date())).toThrow();
        // @ts-expect-error
        expect(() => new RecordId("table", new Decimal(123))).toThrow();
        // @ts-expect-error
        expect(() => new RecordId("table", new Map([["a", 1]]))).toThrow();
        // @ts-expect-error
        expect(() => new RecordId("table", new Set([1, 2, 3]))).toThrow();
        // @ts-expect-error
        expect(() => new RecordId("table", new Set([new RecordId("table", 1)]))).toThrow();
    });

    test("toString()", () => {
        expect(new RecordId("person", 123).toString()).toBe("person:123");
        expect(new RecordId("person", "123").toString()).toBe("person:⟨123⟩");
        expect(new RecordId("person", "123_456").toString()).toBe("person:⟨123_456⟩");
        expect(new RecordId("person", "test").toString()).toBe("person:test");
        expect(new RecordId("person", "complex-ident").toString()).toBe("person:⟨complex-ident⟩");
        expect(new RecordId("person", "⟩").toString()).toBe("person:`⟩`");
        expect(new RecordId("person", "back\\slash").toString()).toBe("person:`back\\\\slash`");
        expect(new RecordId("complex-table", "complex-ident").toString()).toBe(
            "⟨complex-table⟩:⟨complex-ident⟩",
        );

        // Reserved keywords as table names are escaped
        expect(new RecordId("table", 123).toString()).toBe("⟨table⟩:123");
        expect(new RecordId("select", "foo").toString()).toBe("⟨select⟩:foo");
        expect(new RecordId("true", "bar").toString()).toBe("⟨true⟩:bar");

        // UUID
        expect(
            new RecordId("person", new Uuid("d2f72714-a387-487a-8eae-451330796ff4")).toString(),
        ).toBe('person:u"d2f72714-a387-487a-8eae-451330796ff4"');

        // Bigint
        expect(new RecordId("person", 9223372036854775807n).toString()).toBe(
            "person:9223372036854775807",
        );
        expect(new RecordId("person", 9223372036854775808n).toString()).toBe(
            "person:⟨9223372036854775808⟩",
        );

        // Objects and arrays
        expect(
            new RecordId("person", {
                city: "London",
                date: new Date("2024-10-02T08:35:48.715Z"),
            }).toString(),
        ).toBe('person:{ "city": s"London", "date": d"2024-10-02T08:35:48.715Z" }');
        expect(new RecordId("person", ["London"]).toString()).toBe('person:[ s"London" ]');
    });
});
