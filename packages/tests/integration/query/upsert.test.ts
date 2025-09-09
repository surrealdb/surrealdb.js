import { beforeEach, describe, expect, test } from "bun:test";
import { Duration, eq, RecordId } from "surrealdb";
import { resetIncrementalID } from "../../../sdk/src/internal/get-incremental-id";
import { type Person, setupServer } from "../__helpers__";

const { createSurreal } = await setupServer();

beforeEach(async () => {
    resetIncrementalID();
});

describe("upsert()", async () => {
    const surreal = await createSurreal();

    test("single", async () => {
        const single = await surreal.upsert(new RecordId("person", 1));

        expect(single).toStrictEqual({
            id: new RecordId("person", 1),
        });
    });

    test("content", async () => {
        const single = await surreal.upsert<Person>(new RecordId("person", 1)).content({
            firstname: "Peter",
            lastname: "Schoenveter",
        });

        expect(single).toStrictEqual({
            id: new RecordId("person", 1),
            firstname: "Peter",
            lastname: "Schoenveter",
        });
    });

    test("merge", async () => {
        const single = await surreal.upsert<Person>(new RecordId("person", 1)).merge({
            firstname: "Bob",
        });

        expect(single).toStrictEqual({
            id: new RecordId("person", 1),
            firstname: "Bob",
            lastname: "Schoenveter",
        });
    });

    test("replace", async () => {
        const single = await surreal.upsert<Person>(new RecordId("person", 1)).replace({
            firstname: "Jason",
            lastname: "Gibson",
        });

        expect(single).toStrictEqual({
            id: new RecordId("person", 1),
            firstname: "Jason",
            lastname: "Gibson",
        });
    });

    test("compile", async () => {
        const builder = surreal
            .upsert<Person>(new RecordId("person", 1))
            .content({
                firstname: "John",
                lastname: "Doe",
            })
            .where(eq("age", 30))
            .output("diff")
            .timeout(Duration.seconds(1));

        const { query, bindings } = builder.compile();

        expect(query).toMatchSnapshot();
        expect(bindings).toMatchSnapshot();
    });
});
