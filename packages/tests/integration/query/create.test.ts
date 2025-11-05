import { describe, expect, test } from "bun:test";
import { DateTime, Duration, RecordId } from "surrealdb";
import { createSurreal, type Person, personTable } from "../__helpers__";

describe("create()", async () => {
    const surreal = await createSurreal();

    test("single", async () => {
        const single = await surreal.create<Person>(new RecordId("person", 1)).content({
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
        const multiple = await surreal.create<Person>(personTable).content({
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
        const builder = surreal
            .create<Person>(personTable)
            .content({
                id: new RecordId("person", 2),
                firstname: "Mary",
                lastname: "Doe",
            })
            .output("diff")
            .timeout(Duration.seconds(1))
            .version(new DateTime());

        const { query, bindings } = builder.compile();

        expect(query).toMatchSnapshot();
        expect(bindings).toMatchSnapshot();
    });
});
