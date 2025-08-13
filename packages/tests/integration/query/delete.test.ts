import { describe, expect, test } from "bun:test";
import { RecordId } from "surrealdb";
import { insertMockRecords, type Person, personTable, setupServer } from "../__helpers__";

const { createSurreal } = await setupServer();

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
});
