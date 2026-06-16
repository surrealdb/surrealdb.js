import { describe, expect, test } from "bun:test";
import { normaliseScope } from "@surrealdb/spectron";

describe("normaliseScope", () => {
    test("returns undefined for empty inputs", () => {
        expect(normaliseScope(undefined)).toBeUndefined();
        expect(normaliseScope(null)).toBeUndefined();
        expect(normaliseScope("")).toBeUndefined();
        expect(normaliseScope([])).toBeUndefined();
    });

    test("wraps a bare string as a single-path clause", () => {
        expect(normaliseScope("team/eng")).toEqual([["team/eng"]]);
    });

    test("turns a flat array into an OR of singleton clauses", () => {
        expect(normaliseScope(["a/1", "b/2"])).toEqual([["a/1"], ["b/2"]]);
    });

    test("passes a nested array through as an AND clause", () => {
        expect(normaliseScope([["a", "b"]])).toEqual([["a", "b"]]);
    });

    test("mixes bare strings and array clauses", () => {
        expect(normaliseScope(["a", ["b", "c"], "d"])).toEqual([["a"], ["b", "c"], ["d"]]);
    });

    test("de-duplicates within a clause preserving first-seen order", () => {
        expect(normaliseScope([["org/acme", "team/eng", "org/acme"]])).toEqual([
            ["org/acme", "team/eng"],
        ]);
    });

    test("drops empty path strings and clauses that become empty", () => {
        expect(normaliseScope(["", "team/eng"])).toEqual([["team/eng"]]);
        expect(normaliseScope([["", ""], ["team/eng"]])).toEqual([["team/eng"]]);
        expect(normaliseScope([[""]])).toBeUndefined();
    });
});
