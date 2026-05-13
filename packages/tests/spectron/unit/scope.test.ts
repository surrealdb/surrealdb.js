import { describe, expect, test } from "bun:test";
import { deserialiseScope, type Scope, serialiseScope } from "@surrealdb/spectron";

describe("scope", () => {
    test("serialise returns undefined for empty", () => {
        expect(serialiseScope(undefined)).toBeUndefined();
        expect(serialiseScope({})).toBeUndefined();
    });

    test("round trip", () => {
        const scope: Scope = { user: "a", tenant: "b" };
        const wire = serialiseScope(scope);
        expect(wire).toEqual([
            { key: "user", value: "a" },
            { key: "tenant", value: "b" },
        ]);
        expect(deserialiseScope(wire)).toEqual(scope);
    });

    test("deserialise handles undefined", () => {
        expect(deserialiseScope(undefined)).toEqual({});
    });
});
