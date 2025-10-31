import { describe, expect, test } from "bun:test";
import { RecordId } from "surrealdb";
import { setupServer } from "./__helpers__";

const { createSurreal } = await setupServer();

describe("values", async () => {
    test("sets basics", async () => {
        const surreal = await createSurreal();

        await surreal.create(new RecordId("foo", 1)).content({
            set: new Set(["a", "b", "c"]),
        });

        const [result] = await surreal
            .query("SELECT * FROM ONLY foo:1")
            .collect<[{ set: Set<string> }]>();

        expect(result.set).toEqual(new Set(["a", "b", "c"]));
    });

    test("sets uniqueness", async () => {
        const surreal = await createSurreal();

        await surreal.create(new RecordId("foo", 2)).content({
            set: new Set([new RecordId("hello", "world"), new RecordId("hello", "world")]),
        });

        const [result] = await surreal
            .query("SELECT * FROM ONLY foo:2")
            .collect<[{ set: Set<RecordId> }]>();

        expect(result.set).toHaveLength(1);
    });
});
