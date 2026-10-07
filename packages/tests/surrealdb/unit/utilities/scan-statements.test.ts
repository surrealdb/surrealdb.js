import { describe, expect, test } from "bun:test";
import { scanStatements } from "../../../../sdk/src/internal/scan-statements";

describe("scanStatements", () => {
    test("reports nothing for an empty source", () => {
        expect(scanStatements("")).toEqual([]);
        expect(scanStatements("  \n\t ")).toEqual([]);
        expect(scanStatements(";;  ;")).toEqual([]);
    });

    test("reports the first keyword of each statement, upper-cased", () => {
        expect(scanStatements("select * from person; Create person; RETURN 1")).toEqual([
            "SELECT",
            "CREATE",
            "RETURN",
        ]);
    });

    test("does not require a trailing semicolon, and ignores empty statements", () => {
        expect(scanStatements("RETURN 1;;\n;\nRETURN 2;")).toEqual(["RETURN", "RETURN"]);
    });

    test("reports a statement which does not start with a word as an empty string", () => {
        expect(scanStatements("(1 + 2); { a: 1 }; [1, 2]; $x; 'text'; 5; -5")).toEqual([
            "",
            "",
            "",
            "",
            "",
            "",
            "",
        ]);
    });

    test("only reads the keyword at the start of a statement", () => {
        expect(scanStatements("CREATE person SET begin = 1 RETURN AFTER")).toEqual(["CREATE"]);
    });

    test("does not mistake a longer word for a keyword", () => {
        expect(scanStatements("BEGINNING; CANCELLED; COMMITTED")).toEqual([
            "BEGINNING",
            "CANCELLED",
            "COMMITTED",
        ]);
    });

    test("reads transaction statements", () => {
        expect(scanStatements("begin transaction; CREATE a; COMMIT TRANSACTION; CANCEL;")).toEqual([
            "BEGIN",
            "CREATE",
            "COMMIT",
            "CANCEL",
        ]);
    });

    describe("strings and quoted identifiers", () => {
        test("ignores semicolons and keywords inside strings", () => {
            expect(scanStatements(`RETURN 'a; BEGIN; COMMIT;'; RETURN "x; CANCEL;"`)).toEqual([
                "RETURN",
                "RETURN",
            ]);
        });

        test("honors escaped quotes", () => {
            expect(scanStatements(`RETURN 'it\\'s; BEGIN; fine'; SELECT 1`)).toEqual([
                "RETURN",
                "SELECT",
            ]);
            expect(scanStatements(`RETURN "say \\"; BEGIN;\\""; SELECT 1`)).toEqual([
                "RETURN",
                "SELECT",
            ]);
        });

        test("ignores semicolons inside backtick and angle bracket identifiers", () => {
            expect(scanStatements("SELECT `a;b` FROM x; SELECT ⟨c;d⟩ FROM y")).toEqual([
                "SELECT",
                "SELECT",
            ]);
        });

        test("treats the rest of an unterminated string as part of it", () => {
            expect(scanStatements("RETURN 'oops; BEGIN;")).toEqual(["RETURN"]);
        });

        test("reads prefixed strings", () => {
            expect(
                scanStatements(`RETURN r'person:1; BEGIN'; RETURN d'2024-01-01T00:00:00Z'`),
            ).toEqual(["RETURN", "RETURN"]);
        });
    });

    describe("comments", () => {
        test("ignores line comments of every flavor", () => {
            expect(scanStatements("-- BEGIN;\nRETURN 1;\n# BEGIN;\nRETURN 2;\n// BEGIN;")).toEqual([
                "RETURN",
                "RETURN",
            ]);
        });

        test("ignores block comments", () => {
            expect(scanStatements("/* BEGIN; COMMIT; */ RETURN 1; /* ; */ RETURN 2")).toEqual([
                "RETURN",
                "RETURN",
            ]);
        });

        test("an unterminated block comment runs to the end", () => {
            expect(scanStatements("RETURN 1; /* BEGIN;")).toEqual(["RETURN"]);
        });

        test("a line comment ends at the line break, so a semicolon on the next line counts", () => {
            expect(scanStatements("RETURN 1 -- note\n;\nBEGIN")).toEqual(["RETURN", "BEGIN"]);
            expect(scanStatements("RETURN 1 -- note;BEGIN")).toEqual(["RETURN"]);
        });

        test("a comment can come first in a statement", () => {
            expect(scanStatements("-- first\n  /* second */ BEGIN")).toEqual(["BEGIN"]);
        });
    });

    describe("blocks", () => {
        test("ignores semicolons inside braces", () => {
            expect(scanStatements("LET $a = { LET $b = 1; RETURN $b }; RETURN $a")).toEqual([
                "LET",
                "RETURN",
            ]);
        });

        test("ignores statements inside nested blocks", () => {
            expect(
                scanStatements(
                    "IF $x { IF $y { BEGIN; COMMIT; } }; DEFINE FUNCTION fn::a() { 1; 2 }",
                ),
            ).toEqual(["IF", "DEFINE"]);
        });

        test("ignores semicolons inside parentheses and brackets", () => {
            expect(scanStatements("RETURN (1; 2); RETURN [3; 4]; RETURN 5")).toEqual([
                "RETURN",
                "RETURN",
                "RETURN",
            ]);
        });

        test("does not let stray closing brackets go negative", () => {
            expect(scanStatements("RETURN 1 }); BEGIN")).toEqual(["RETURN", "BEGIN"]);
        });
    });
});
