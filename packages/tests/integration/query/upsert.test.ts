import { describe, expect, test } from "bun:test";
import { Duration, eq, RecordId } from "surrealdb";
import { createSurreal, type Person } from "../__helpers__";

describe("upsert()", async () => {
    test("single", async () => {
        const surreal = await createSurreal();
        const single = await surreal.upsert(new RecordId("person", 1));

        expect(single).toStrictEqual({
            id: new RecordId("person", 1),
        });
    });

    test("content", async () => {
        const surreal = await createSurreal();
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
        const surreal = await createSurreal();

        await surreal.create<Person>(new RecordId("person", 1)).content({
            firstname: "Peter",
            lastname: "Schoenveter",
        });

        const single = await surreal.upsert<Person>(new RecordId("person", 1)).merge({
            firstname: "Joost",
        });

        expect(single).toStrictEqual({
            id: new RecordId("person", 1),
            firstname: "Joost",
            lastname: "Schoenveter",
        });
    });

    test("replace", async () => {
        const surreal = await createSurreal();
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
        const surreal = await createSurreal();
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
