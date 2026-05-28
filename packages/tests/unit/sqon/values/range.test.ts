import { describe, expect, test } from "bun:test";
import { BoundExcluded, BoundIncluded, Range } from "surrealdb";

describe("Range", () => {
    test("construct with both bounds", () => {
        const range = new Range(new BoundIncluded(1), new BoundExcluded(10));
        expect(range.begin).toBeInstanceOf(BoundIncluded);
        expect(range.begin?.value).toBe(1);
        expect(range.end).toBeInstanceOf(BoundExcluded);
        expect(range.end?.value).toBe(10);
    });

    test("construct with undefined begin", () => {
        const range = new Range(undefined, new BoundIncluded(10));
        expect(range.begin).toBeUndefined();
        expect(range.end).toBeInstanceOf(BoundIncluded);
    });

    test("construct with undefined end", () => {
        const range = new Range(new BoundExcluded(5), undefined);
        expect(range.begin).toBeInstanceOf(BoundExcluded);
        expect(range.end).toBeUndefined();
    });

    test("construct fully unbounded", () => {
        const range = new Range(undefined, undefined);
        expect(range.begin).toBeUndefined();
        expect(range.end).toBeUndefined();
    });

    test("equals with matching bounds", () => {
        const a = new Range(new BoundIncluded(1), new BoundExcluded(10));
        const b = new Range(new BoundIncluded(1), new BoundExcluded(10));
        expect(a.equals(b)).toBe(true);
    });

    test("not equals with different values", () => {
        const a = new Range(new BoundIncluded(1), new BoundExcluded(10));
        const b = new Range(new BoundIncluded(2), new BoundExcluded(10));
        expect(a.equals(b)).toBe(false);
    });

    test("not equals with different bound types", () => {
        const a = new Range(new BoundIncluded(1), new BoundExcluded(10));
        const b = new Range(new BoundExcluded(1), new BoundExcluded(10));
        expect(a.equals(b)).toBe(false);
    });

    test("not equals with non-Range", () => {
        const range = new Range(new BoundIncluded(1), new BoundExcluded(10));
        expect(range.equals("not a range")).toBe(false);
    });

    test("toString", () => {
        const range = new Range(new BoundIncluded(1), new BoundExcluded(10));
        const str = range.toString();
        expect(typeof str).toBe("string");
        expect(str.length).toBeGreaterThan(0);
    });
});
