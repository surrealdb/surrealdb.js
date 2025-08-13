import { describe, expect, test } from "bun:test";
import { RecordId } from "surrealdb";
import { insertMockRecords, type Person, personTable, setupServer } from "../__helpers__";

const { createSurreal } = await setupServer();

describe("patch()", async () => {
    const surreal = await createSurreal();

    await insertMockRecords(surreal);

    test("single", async () => {
        const single = await surreal.patch<Person>(new RecordId("person", 1), [
            { op: "replace", path: "/firstname", value: "John" },
        ]);

        expect(single).toStrictEqual({
            id: new RecordId("person", 1),
            firstname: "John",
            lastname: "Doe",
        });
    });

    test("multiple", async () => {
        const multiple = await surreal.patch<Person>(personTable, [
            { op: "replace", path: "/age", value: 30 },
        ]);

        expect(multiple).toStrictEqual([
            {
                id: new RecordId("person", 1),
                firstname: "John",
                lastname: "Doe",
                age: 30,
            },
            {
                id: new RecordId("person", 2),
                firstname: "Mary",
                lastname: "Doe",
                age: 30,
            },
        ]);
    });

    test("single diff", async () => {
        const singleDiff = await surreal.patch(
            new RecordId("person", 1),
            [{ op: "replace", path: "/age", value: 25 }],
            true,
        );

        expect(singleDiff).toStrictEqual([{ op: "replace", path: "/age", value: 25 }]);
    });

    test("multiple diff", async () => {
        const multipleDiff = await surreal.patch(
            personTable,
            [{ op: "replace", path: "/age", value: 20 }],
            true,
        );

        expect(multipleDiff).toStrictEqual([
            [{ op: "replace", path: "/age", value: 20 }],
            [{ op: "replace", path: "/age", value: 20 }],
        ]);
    });
});
