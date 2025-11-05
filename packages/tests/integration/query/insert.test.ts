import { describe, expect, test } from "bun:test";
import { DateTime, Duration, RecordId } from "surrealdb";
import { createSurreal, type Person } from "../__helpers__";

describe("insert()", async () => {
    const surreal = await createSurreal();

    test("single", async () => {
        const [single] = await surreal.insert<Person>({
            id: new RecordId("person", 1),
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
        const multiple = await surreal.insert<Person>([
            {
                id: new RecordId("person", 3),
                firstname: "John",
                lastname: "Doe",
            },
            {
                id: new RecordId("person", 4),
                firstname: "Mary",
                lastname: "Doe",
            },
        ]);

        expect(multiple).toStrictEqual([
            {
                id: new RecordId("person", 3),
                firstname: "John",
                lastname: "Doe",
            },
            {
                id: new RecordId("person", 4),
                firstname: "Mary",
                lastname: "Doe",
            },
        ]);
    });

    test("compile", async () => {
        const builder = surreal
            .insert<Person>([
                {
                    id: new RecordId("person", 3),
                    firstname: "John",
                    lastname: "Doe",
                },
            ])
            .ignore()
            .output("diff")
            .relation()
            .timeout(Duration.seconds(1))
            .version(new DateTime());

        const { query, bindings } = builder.compile();

        expect(query).toMatchSnapshot();
        expect(bindings).toMatchSnapshot();
    });
});
