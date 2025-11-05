import { describe, expect, test } from "bun:test";
import { DateTime, Duration, RecordId } from "surrealdb";
import { createSurreal, insertMockRecords, type Person, personTable } from "../__helpers__";

describe("delete()", async () => {
    const surreal = await createSurreal();

    await insertMockRecords(surreal);

    test("single", async () => {
        const single = await surreal.delete<Person>(new RecordId("person", 1));

        expect(single).toStrictEqual({
            id: new RecordId("person", 1),
            firstname: "John",
            lastname: "Doe",
        });
    });

    test("multiple", async () => {
        const multiple = await surreal.delete<Person>(personTable);

        expect(multiple).toStrictEqual([
            {
                id: new RecordId("person", 2),
                firstname: "Mary",
                lastname: "Doe",
            },
        ]);
    });

    test("compile", async () => {
        const builder = surreal
            .delete<Person>(personTable)
            .output("diff")
            .timeout(Duration.seconds(1))
            .version(new DateTime());

        const { query, bindings } = builder.compile();

        expect(query).toMatchSnapshot();
        expect(bindings).toMatchSnapshot();
    });
});
