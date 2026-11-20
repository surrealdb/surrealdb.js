import { describe, expect, test } from "bun:test";
import {
    BoundExcluded,
    BoundIncluded,
    escapeIdent,
    escapeIdPart,
    escapeNumber,
    RecordId,
    RecordIdRange,
    TextCodec,
} from "surrealdb";

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

// A record id key follows the server's `EscapeRidKey` rule, not the table name rule of
// `escapeIdent`: it may start with a digit or be a keyword, but not be only digits and underscores.
describe("record id key escaping", () => {
    test("leaves keys that start with a digit bare", () => {
        expect(escapeIdPart("8pkgf59qqokxbqjtured")).toBe("8pkgf59qqokxbqjtured");
        expect(escapeIdPart("1abc")).toBe("1abc");
        expect(escapeIdPart("1e10")).toBe("1e10");
        expect(escapeIdPart("8d")).toBe("8d");
        expect(escapeIdPart("0x10")).toBe("0x10");
        expect(escapeIdPart("1_a")).toBe("1_a");
    });

    test("leaves reserved keywords bare", () => {
        expect(escapeIdPart("select")).toBe("select");
        expect(escapeIdPart("none")).toBe("none");
        expect(escapeIdPart("TRUE")).toBe("TRUE");
    });

    test("delimits keys of only digits and underscores", () => {
        expect(escapeIdPart("123")).toBe("⟨123⟩");
        expect(escapeIdPart("1_000")).toBe("⟨1_000⟩");
        expect(escapeIdPart("_1")).toBe("⟨_1⟩");
        expect(escapeIdPart("_")).toBe("⟨_⟩");
    });

    test("delimits NaN and Infinity only in exact case", () => {
        expect(escapeIdPart("NaN")).toBe("⟨NaN⟩");
        expect(escapeIdPart("Infinity")).toBe("⟨Infinity⟩");
        expect(escapeIdPart("nan")).toBe("nan");
        expect(escapeIdPart("INFINITY")).toBe("INFINITY");
    });

    test("delimits empty keys and keys with other characters", () => {
        expect(escapeIdPart("")).toBe("⟨⟩");
        expect(escapeIdPart("hello-world")).toBe("⟨hello-world⟩");
        expect(escapeIdPart("1 a")).toBe("⟨1 a⟩");
        expect(escapeIdPart("with⟩angle")).toBe("`with⟩angle`");
        expect(escapeIdPart("back\\slash")).toBe("`back\\\\slash`");
    });

    test("record ids and ranges escape the table and key by their own rules", () => {
        expect(new RecordId("my_table", "8pkgf59qqokxbqjtured").toString()).toBe(
            "my_table:8pkgf59qqokxbqjtured",
        );
        expect(new RecordId("1abc", "1abc").toString()).toBe("⟨1abc⟩:1abc");
        expect(new RecordId("select", "select").toString()).toBe("⟨select⟩:select");
        expect(
            new RecordIdRange("t", new BoundExcluded("1e10"), new BoundIncluded("8d")).toString(),
        ).toBe("t:1e10>..=8d");
        expect(new RecordIdRange("t", undefined, new BoundExcluded("_1")).toString()).toBe(
            "t:..⟨_1⟩",
        );
    });

    test("escaped keys decode back to the same record id", () => {
        const keys = [
            "8pkgf59qqokxbqjtured",
            "1abc",
            "1e10",
            "8d",
            "0x10",
            "1_a",
            "select",
            "123",
            "1_000",
            "_1",
            "NaN",
            "Infinity",
            "",
            "hello-world",
        ];

        for (const key of keys) {
            const id = new RecordId("t", key);
            expect((TextCodec.parseValue(id.toString()) as RecordId).equals(id)).toBe(true);
        }

        const range = new RecordIdRange("t", new BoundExcluded("1e10"), new BoundIncluded("8d"));
        expect((TextCodec.parseValue(range.toString()) as RecordIdRange).equals(range)).toBe(true);
    });
});
