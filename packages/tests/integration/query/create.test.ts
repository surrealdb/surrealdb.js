import { describe, expect, test } from "bun:test";
import { RecordId } from "surrealdb";
import { type Person, personTable, setupServer } from "../__helpers__";

const { createSurreal } = await setupServer();

describe("create()", async () => {
    const surreal = await createSurreal();

    test("single", async () => {
        const single = await surreal.create<Person, Omit<Person, "id">>(new RecordId("person", 1), {
            firstname: "John",
            lastname: "Doe",
        });

        expect(single).toStrictEqual({
            id: new RecordId("person", 1),
            firstname: "John",
            lastname: "Doe",
        });
    });

    test("multiple", async () => {
        const multiple = await surreal.create<Person>(personTable, {
            id: new RecordId("person", 2),
            firstname: "Mary",
            lastname: "Doe",
        });

        expect(multiple).toStrictEqual([
            {
                id: new RecordId("person", 2),
                firstname: "Mary",
                lastname: "Doe",
            },
        ]);
    });
});
