import { describe, expect, test } from "bun:test";
import { DateTime, Duration, RecordId } from "surrealdb";
import { createSurreal, type Person, personTable, proto } from "../__helpers__";

describe("create()", async () => {
    test("single", async () => {
        const surreal = await createSurreal();
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
        const surreal = await createSurreal();
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
        const surreal = await createSurreal();
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

        expect(query).toMatchSnapshot(proto("query"));
        expect(bindings).toMatchSnapshot(proto("bindings"));
    });
});
