import { describe, expect, test } from "bun:test";
import { escapeIdent, escapeNumber, TextCodec } from "surrealdb";

describe("escape functions", () => {
    test("empty ident", () => {
        expect(escapeIdent("")).toBe("⟨⟩");
    });

    test("numeric ident", () => {
        expect(escapeIdent("123")).toBe("⟨123⟩");
    });

    test("underscore ident", () => {
        expect(escapeIdent("hello_world")).toBe("hello_world");
    });

    test("hyphenated ident", () => {
        expect(escapeIdent("hello-world")).toBe("⟨hello-world⟩");
    });

    test("bigint number", () => {
        expect(escapeNumber(9223372036854775807n)).toBe("9223372036854775807");
        expect(escapeNumber(9223372036854775808n)).toBe("⟨9223372036854775808⟩");
    });

    test("ident starting with digit or duration prefix", () => {
        expect(escapeIdent("2d_metrics")).toBe("⟨2d_metrics⟩");
        expect(escapeIdent("1foo")).toBe("⟨1foo⟩");
        expect(escapeIdent("0test")).toBe("⟨0test⟩");
        expect(escapeIdent("10ms_duration")).toBe("⟨10ms_duration⟩");
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

    test("uses backticks for identifiers containing backslashes", () => {
        expect(escapeIdent("back\\slash")).toBe("`back\\\\slash`");
        expect(escapeIdent("trailing\\")).toBe("`trailing\\\\`");
        expect(escapeIdent("\\⟩")).toBe("`\\\\⟩`");
        expect(escapeIdent("tick`and\\slash")).toBe("`tick\\`and\\\\slash`");
    });

    test("uses backticks for identifiers containing ⟩", () => {
        expect(escapeIdent("⟩")).toBe("`⟩`");
        expect(escapeIdent("with⟩angle")).toBe("`with⟩angle`");
        expect(escapeIdent("tick`and⟩angle")).toBe("`tick\\`and⟩angle`");
    });

    test("leaves backticks unescaped inside angle brackets", () => {
        expect(escapeIdent("tick`")).toBe("⟨tick`⟩");
    });

    test("escaped identifiers decode back to the original name", () => {
        const names = ["hello-world", "back\\slash", "trailing\\", "with⟩angle", "\\⟩", "tick`"];

        for (const name of names) {
            expect(TextCodec.parseTable(escapeIdent(name)).name).toBe(name);
        }
    });
});
