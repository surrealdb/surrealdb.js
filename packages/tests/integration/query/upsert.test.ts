import { beforeEach, describe, expect, test } from "bun:test";
import { RecordId } from "surrealdb";
import { resetIncrementalID } from "../../../sdk/src/internal/get-incremental-id";
import { type Person, setupServer } from "../__helpers__";

const { createSurreal } = await setupServer();

beforeEach(async () => {
    resetIncrementalID();
});

describe("upsert()", async () => {
    const surreal = await createSurreal();

    test("single", async () => {
        const single = await surreal.upsert<Person, Omit<Person, "id">>(new RecordId("person", 1), {
            firstname: "John",
            lastname: "Doe",
        });

        expect(single).toStrictEqual({
            id: new RecordId("person", 1),
            firstname: "John",
            lastname: "Doe",
        });
    });

    test("compile", async () => {
        const builder = surreal.upsert<Person, Omit<Person, "id">>(new RecordId("person", 1), {
            firstname: "John",
            lastname: "Doe",
        });

        const { query, bindings } = builder.compile();

        expect(query).toMatchSnapshot();
        expect(bindings).toMatchSnapshot();
    });
});
