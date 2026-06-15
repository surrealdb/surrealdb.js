import { describe, expect, test } from "bun:test";
import { normaliseScope, type Scope } from "@surrealdb/spectron";

describe("normaliseScope", () => {
    test("returns undefined for empty inputs", () => {
        expect(normaliseScope(undefined)).toBeUndefined();
        expect(normaliseScope(null)).toBeUndefined();
        expect(normaliseScope("")).toBeUndefined();
        expect(normaliseScope({})).toBeUndefined();
        expect(normaliseScope([])).toBeUndefined();
    });

    test("maps a record to slash-path strings", () => {
        const scope: Scope = { user: "a", tenant: "b" };
        expect(normaliseScope(scope)).toEqual(["user/a", "tenant/b"]);
    });

    test("passes a single path string through", () => {
        expect(normaliseScope("team/eng")).toEqual(["team/eng"]);
    });

    test("passes a path-string array through", () => {
        expect(normaliseScope(["a/1", "b/2"])).toEqual(["a/1", "b/2"]);
    });

    test("joins tuple pairs into slash-paths", () => {
        expect(
            normaliseScope([
                ["a", "1"],
                ["b", "2"],
            ]),
        ).toEqual(["a/1", "b/2"]);
    });

    test("de-duplicates while preserving first-seen order", () => {
        expect(normaliseScope(["org/acme", "team/eng", "org/acme"])).toEqual([
            "org/acme",
            "team/eng",
        ]);
    });

    test("drops empty path strings", () => {
        expect(normaliseScope(["", "team/eng"])).toEqual(["team/eng"]);
    });
});
