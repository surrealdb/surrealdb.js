import { describe, expect, test } from "bun:test";
import { BoundExcluded, BoundIncluded, RecordIdRange } from "surrealdb";

describe("RecordIdRange", () => {
    test("construct with included/excluded bounds", () => {
        const range = new RecordIdRange("users", new BoundIncluded(1), new BoundExcluded(100));
        expect(range.table.name).toBe("users");
        expect(range.begin).toBeInstanceOf(BoundIncluded);
        expect(range.begin?.value).toBe(1);
        expect(range.end).toBeInstanceOf(BoundExcluded);
        expect(range.end?.value).toBe(100);
    });

    test("construct with unbounded begin", () => {
        const range = new RecordIdRange("users", undefined, new BoundIncluded(50));
        expect(range.begin).toBeUndefined();
        expect(range.end).toBeInstanceOf(BoundIncluded);
    });

    test("equals", () => {
        const a = new RecordIdRange("users", new BoundIncluded(1), new BoundExcluded(100));
        const b = new RecordIdRange("users", new BoundIncluded(1), new BoundExcluded(100));
        expect(a.equals(b)).toBe(true);
    });

    test("not equals with different table", () => {
        const a = new RecordIdRange("users", new BoundIncluded(1), new BoundExcluded(100));
        const b = new RecordIdRange("posts", new BoundIncluded(1), new BoundExcluded(100));
        expect(a.equals(b)).toBe(false);
    });

    test("not equals with different bounds", () => {
        const a = new RecordIdRange("users", new BoundIncluded(1), new BoundExcluded(100));
        const b = new RecordIdRange("users", new BoundIncluded(1), new BoundExcluded(200));
        expect(a.equals(b)).toBe(false);
    });

    test("not equals with non-RecordIdRange", () => {
        const range = new RecordIdRange("users", new BoundIncluded(1), new BoundExcluded(100));
        expect(range.equals("not a range")).toBe(false);
    });

    test("toString", () => {
        const range = new RecordIdRange("users", new BoundIncluded(1), new BoundExcluded(100));
        const str = range.toString();
        expect(typeof str).toBe("string");
        expect(str).toContain("users");
    });
});
