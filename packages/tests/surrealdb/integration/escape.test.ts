import { describe, expect, test } from "bun:test";
import { escapeIdent, RecordId } from "surrealdb";
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
