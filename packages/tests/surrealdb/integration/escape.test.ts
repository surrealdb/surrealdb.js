import { describe, expect, test } from "bun:test";
import {
    BoundExcluded,
    BoundIncluded,
    escapeIdent,
    RecordId,
    RecordIdRange,
    Table,
} from "surrealdb";
import { createSurreal } from "./__helpers__";

const NAMES = [
    "hello-world",
    "back\\slash",
    "trailing\\",
    "with⟩angle",
    "\\⟩",
    "tick`",
    "tick`and⟩angle",
    "⟨both⟩",
    "ünïcödé",
];

describe("escapeIdent()", () => {
    test("table names reach the server unchanged", async () => {
        const surreal = await createSurreal();

        await surreal.query(NAMES.map((name) => `DEFINE TABLE ${escapeIdent(name)};`).join("\n"));

        const [info] = await surreal
            .query("INFO FOR DB")
            .collect<[{ tables: Record<string, string> }]>();

        expect(Object.keys(info.tables).sort()).toEqual([...NAMES].sort());
    });

    test("record ids reach the server unchanged", async () => {
        const surreal = await createSurreal();

        for (const name of NAMES) {
            const id = new RecordId(name, name);
            const [result] = await surreal.query(`RETURN ${id.toString()}`).collect<[RecordId]>();

            expect(result.equals(id)).toBe(true);
        }
    });
});

// Keys where the record id key rule differs from the table name rule.
const KEYS = [
    "8pkgf59qqokxbqjtured",
    "1abc",
    "1e10",
    "8d",
    "0x10",
    "1_a",
    "select",
    "none",
    "123",
    "1_000",
    "_1",
    "NaN",
    "Infinity",
    "nan",
    "INFINITY",
];

/**
 * The SDK delimits with `⟨⟩`, and the server with backticks from 2.6 (with `⟨⟩` before), so
 * compare displays with the delimiters made the same.
 */
function normalise(display: string): string {
    return display.replace(/⟨([^⟩`\\]*)⟩/g, "`$1`");
}

describe("record id keys", () => {
    test("render as the server displays them and parse back", async () => {
        const surreal = await createSurreal();

        for (const key of KEYS) {
            const id = new RecordId("t", key);
            const [parsed, shown] = await surreal
                .query(`RETURN ${id.toString()}; RETURN <string> $id;`, { id })
                .collect<[RecordId, string]>();

            expect(parsed.equals(id)).toBe(true);

            // Before 2.6 the server shows the key `NaN` or `Infinity` bare, though it cannot read
            // that back.
            const rendered = normalise(id.toString());
            const displays =
                key === "NaN" || key === "Infinity" ? [rendered, `t:${key}`] : [rendered];
            expect(displays).toContain(normalise(shown));
        }
    });

    test("range bounds render as the server displays them and parse back", async () => {
        const surreal = await createSurreal();
        const ranges = [
            new RecordIdRange("t", new BoundIncluded("1e10"), new BoundExcluded("8d")),
            new RecordIdRange("t", new BoundExcluded("select"), new BoundIncluded("8pkgf59")),
            new RecordIdRange("t", undefined, new BoundIncluded("_1")),
        ];

        for (const range of ranges) {
            const [parsed, shown] = await surreal
                .query(`RETURN ${range.toString()}; RETURN <string> $range;`, { range })
                .collect<[RecordIdRange, string]>();

            expect(parsed.equals(range)).toBe(true);
            expect(normalise(shown)).toBe(normalise(range.toString()));
        }
    });

    test("generated ids render as the server displays them", async () => {
        const surreal = await createSurreal();

        // About a quarter of generated ids start with a digit, which was the case that differed.
        const records = await surreal.insert<{ index: number }>(
            new Table("generated"),
            Array.from({ length: 40 }, (_, index) => ({ index })),
        );
        const [shown] = await surreal
            .query("SELECT VALUE <string> id FROM generated")
            .collect<[string[]]>();

        expect(records.map(({ id }) => normalise(id.toString())).sort()).toEqual(
            shown.map(normalise).sort(),
        );
    });
});
