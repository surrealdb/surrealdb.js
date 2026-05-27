import { describe, expect, test } from "bun:test";
import { InvalidRecordIdError, RecordId, StringRecordId } from "surrealdb";

describe("StringRecordId", () => {
    test("construct from string", () => {
        const srid = new StringRecordId("users:bob");
        expect(srid.toString()).toBe("users:bob");
    });

    test("construct from StringRecordId", () => {
        const original = new StringRecordId("users:bob");
        const cloned = new StringRecordId(original);
        expect(cloned.toString()).toBe("users:bob");
    });

    test("construct from RecordId", () => {
        const rid = new RecordId("users", "bob");
        const srid = new StringRecordId(rid);
        expect(srid.toString()).toBe(rid.toString());
    });

    test("rejects non-string", () => {
        // @ts-expect-error
        expect(() => new StringRecordId(123)).toThrow(InvalidRecordIdError);
    });

    test("equals", () => {
        const a = new StringRecordId("users:bob");
        const b = new StringRecordId("users:bob");
        const c = new StringRecordId("users:alice");
        expect(a.equals(b)).toBe(true);
        expect(a.equals(c)).toBe(false);
        expect(a.equals("users:bob")).toBe(false);
    });
});
