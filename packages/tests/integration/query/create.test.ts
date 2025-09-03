import { beforeEach, describe, expect, test } from "bun:test";
import { RecordId } from "surrealdb";
import { resetIncrementalID } from "../../../sdk/src/internal/get-incremental-id";
import { type Person, personTable, setupServer } from "../__helpers__";

const { createSurreal } = await setupServer();

beforeEach(async () => {
    resetIncrementalID();
});

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

    test("compile", async () => {
        const builder = surreal.create<Person>(personTable, {
            id: new RecordId("person", 2),
            firstname: "Mary",
            lastname: "Doe",
        });

        const { query, bindings } = builder.compile();

        expect(query).toMatchSnapshot();
        expect(bindings).toMatchSnapshot();
    });
});
