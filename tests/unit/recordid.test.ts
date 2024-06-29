import { describe, test, expect } from "bun:test";
import { RecordId } from "../../src";

describe("record ids", () => {
    test("toString()", () => {
        expect(new RecordId("table", 123).toString()).toBe("table:123");
        expect(new RecordId("table", "123").toString()).toBe("table:⟨123⟩");
        expect(new RecordId("table", "test").toString()).toBe("table:test");
        expect(new RecordId("table", "complex-ident").toString()).toBe(
            "table:⟨complex-ident⟩",
        );
        expect(new RecordId("complex-table", "complex-ident").toString()).toBe(
            "⟨complex-table⟩:⟨complex-ident⟩",
        );

        // Bigint
        expect(new RecordId("table", 9223372036854775807n).toString()).toBe(
            "table:9223372036854775807",
        );
        expect(new RecordId("table", 9223372036854775808n).toString()).toBe(
            "table:⟨9223372036854775808⟩",
        );

        // Objects and arrays
        // expect(new RecordId("table"))
    });
});
