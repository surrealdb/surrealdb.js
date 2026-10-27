import { describe, expect, test } from "bun:test";
import { PublishError } from "surrealdb";

describe("PublishError", () => {
    test("lists every direct cause", () => {
        const error = new PublishError([new Error("first"), "second"]);

        expect(error.message).toBe(
            "One or more subscribers threw an error:\n  - first\n  - second",
        );
        expect(error.leafCauses).toEqual(error.causes);
    });

    test("lists the causes of every nested PublishError", () => {
        const a = new Error("a");
        const b = new Error("b");
        const c = new Error("c");
        const d = new Error("d");
        const error = new PublishError([
            a,
            new PublishError([b, c]),
            new PublishError([new PublishError([d])]),
        ]);

        expect(error.message).toBe(
            "One or more subscribers threw an error:\n  - a\n  - b\n  - c\n  - d",
        );
        expect(error.leafCauses).toEqual([a, b, c, d]);
        expect(error.causes).toHaveLength(3);
    });
});
