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

    test("escapes reserved keywords case-insensitively", () => {
        expect(escapeIdent("true")).toBe("⟨true⟩");
        expect(escapeIdent("TRUE")).toBe("⟨TRUE⟩");
        expect(escapeIdent("True")).toBe("⟨True⟩");
        expect(escapeIdent("false")).toBe("⟨false⟩");
        expect(escapeIdent("null")).toBe("⟨null⟩");
        expect(escapeIdent("none")).toBe("⟨none⟩");
        expect(escapeIdent("select")).toBe("⟨select⟩");
        expect(escapeIdent("SELECT")).toBe("⟨SELECT⟩");
        expect(escapeIdent("update")).toBe("⟨update⟩");
        expect(escapeIdent("explain")).toBe("⟨explain⟩");
        expect(escapeIdent("function")).toBe("⟨function⟩");
    });

    test("escapes NaN and Infinity only in exact case", () => {
        expect(escapeIdent("NaN")).toBe("⟨NaN⟩");
        expect(escapeIdent("nan")).toBe("nan");
        expect(escapeIdent("NAN")).toBe("NAN");
        expect(escapeIdent("Infinity")).toBe("⟨Infinity⟩");
        expect(escapeIdent("infinity")).toBe("infinity");
        expect(escapeIdent("INFINITY")).toBe("INFINITY");
    });
});
