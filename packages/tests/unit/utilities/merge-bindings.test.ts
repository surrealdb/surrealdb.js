import { describe, expect, test } from "bun:test";
import { mergeBindings } from "../../../sdk/src/utils/bound-query";

describe("mergeBindings", () => {
    test("merges non-overlapping bindings", () => {
        const target: Record<string, unknown> = { a: 1 };
        mergeBindings(target, { b: 2, c: 3 });

        expect(target).toEqual({ a: 1, b: 2, c: 3 });
    });

    test("merges into empty target", () => {
        const target: Record<string, unknown> = {};
        mergeBindings(target, { a: 1 });

        expect(target).toEqual({ a: 1 });
    });

    test("merges empty source", () => {
        const target: Record<string, unknown> = { a: 1 };
        mergeBindings(target, {});

        expect(target).toEqual({ a: 1 });
    });

    test("throws on conflicting key", () => {
        const target: Record<string, unknown> = { x: 1 };

        expect(() => mergeBindings(target, { x: 2 })).toThrow(
            "Parameter conflict: 'x' already exists in this BoundQuery",
        );
    });
});
