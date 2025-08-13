import { describe, expect, test } from "bun:test";
import { RecordId, Uuid } from "surrealdb";

describe("record ids", () => {
    test("toString()", () => {
        expect(new RecordId("table", 123).toString()).toBe("table:123");
        expect(new RecordId("table", "123").toString()).toBe("table:⟨123⟩");
        expect(new RecordId("table", "123_456").toString()).toBe("table:⟨123_456⟩");
        expect(new RecordId("table", "test").toString()).toBe("table:test");
        expect(new RecordId("table", "complex-ident").toString()).toBe("table:⟨complex-ident⟩");
        expect(new RecordId("table", "⟩").toString()).toBe("table:⟨\\⟩⟩");
        expect(new RecordId("complex-table", "complex-ident").toString()).toBe(
            "⟨complex-table⟩:⟨complex-ident⟩",
        );

        // UUID
        expect(
            new RecordId("table", new Uuid("d2f72714-a387-487a-8eae-451330796ff4")).toString(),
        ).toBe('table:u"d2f72714-a387-487a-8eae-451330796ff4"');

        // Bigint
        expect(new RecordId("table", 9223372036854775807n).toString()).toBe(
            "table:9223372036854775807",
        );
        expect(new RecordId("table", 9223372036854775808n).toString()).toBe(
            "table:⟨9223372036854775808⟩",
        );

        // Objects and arrays
        expect(
            new RecordId("table", {
                city: "London",
                date: new Date("2024-10-02T08:35:48.715Z"),
            }).toString(),
        ).toBe('table:{ "city": s"London", "date": d"2024-10-02T08:35:48.715Z" }');

        expect(new RecordId("table", ["London"]).toString()).toBe('table:[ s"London" ]');
    });
});
