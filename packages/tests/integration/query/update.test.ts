import { describe, expect, test } from "bun:test";
import { Duration, eq, RecordId } from "surrealdb";
import { createSurreal, insertMockRecords, type Person, proto } from "../__helpers__";

describe("update()", async () => {
    test("single", async () => {
        const surreal = await createSurreal();
        await insertMockRecords(surreal);
        const single = await surreal.update<Person>(new RecordId("person", 1));

        expect(single).toStrictEqual({
            id: new RecordId("person", 1),
            firstname: "John",
            lastname: "Doe",
        });
    });

    test("content", async () => {
        const surreal = await createSurreal();
        await insertMockRecords(surreal);
        const single = await surreal.update<Person>(new RecordId("person", 1)).content({
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
        await insertMockRecords(surreal);
        const single = await surreal.update<Person>(new RecordId("person", 1)).merge({
            firstname: "Bob",
        });

        expect(single).toStrictEqual({
            id: new RecordId("person", 1),
            firstname: "Bob",
            lastname: "Doe",
        });
    });

    test("replace", async () => {
        const surreal = await createSurreal();
        await insertMockRecords(surreal);
        const single = await surreal.update<Person>(new RecordId("person", 1)).replace({
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
            .update<Person>(new RecordId("person", 1))
            .content({
                firstname: "John",
                lastname: "Doe",
            })
            .where(eq("age", 30))
            .output("diff")
            .timeout(Duration.seconds(1));

        const { query, bindings } = builder.compile();

        expect(query).toMatchSnapshot(proto("query"));
        expect(bindings).toMatchSnapshot(proto("bindings"));
    });
});
