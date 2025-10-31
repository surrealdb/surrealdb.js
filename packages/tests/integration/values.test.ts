import { describe, expect, test } from "bun:test";
import { satisfies } from "semver";
import { RecordId } from "surrealdb";
import { fetchVersion, setupServer } from "./__helpers__";

const { createSurreal } = await setupServer();

describe("values", async () => {
    const surreal = await createSurreal();
    const version = await fetchVersion(surreal);

    const is3x = satisfies(version, ">=3.0.0-alpha.1");

    test.if(is3x)("sets basics", async () => {
        await surreal.create(new RecordId("foo", 1)).content({
            set: new Set(["a", "b", "c"]),
        });

        const [result] = await surreal
            .query("SELECT * FROM ONLY foo:1")
            .collect<[{ set: Set<string> }]>();

        expect(result.set).toEqual(new Set(["a", "b", "c"]));
    });

    test.if(is3x)("sets uniqueness", async () => {
        await surreal.create(new RecordId("foo", 2)).content({
            set: new Set([new RecordId("hello", "world"), new RecordId("hello", "world")]),
        });

        const [result] = await surreal
            .query("SELECT * FROM ONLY foo:2")
            .collect<[{ set: Set<RecordId> }]>();

        expect(result.set).toHaveLength(1);
    });
});
