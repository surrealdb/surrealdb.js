import { describe, expect, test } from "bun:test";
import { escapeIdent, escapeNumber } from "surrealdb";

describe("escape functions", () => {
    test("empty ident", () => {
        expect(escapeIdent("")).toBe("⟨⟩");
    });

    test("numeric ident", () => {
        expect(escapeIdent("123")).toBe("⟨123⟩");
    });

    test("nderscore ident", () => {
        expect(escapeIdent("hello_world")).toBe("hello_world");
    });

    test("hyphenated ident", () => {
        expect(escapeIdent("hello-world")).toBe("⟨hello-world⟩");
    });

    test("bigint number", () => {
        expect(escapeNumber(9223372036854775807n)).toBe("9223372036854775807");
        expect(escapeNumber(9223372036854775808n)).toBe("⟨9223372036854775808⟩");
    });
});
