import { describe, expect, test } from "bun:test";
import { BoundIncluded, DateTime, Duration, eq, RecordId, RecordIdRange } from "surrealdb";
import { createSurreal, insertMockRecords, type Person, personTable, proto } from "../__helpers__";

describe("select()", async () => {
    test("single", async () => {
        const surreal = await createSurreal();
        await insertMockRecords(surreal);
        const single = await surreal.select<Person>(new RecordId("person", 1));

        expect(single).toStrictEqual({
            id: new RecordId("person", 1),
            firstname: "John",
            lastname: "Doe",
        });
    });

    test("multiple", async () => {
        const surreal = await createSurreal();
        await insertMockRecords(surreal);
        const multiple = await surreal.select<Person>(personTable);

        expect(multiple).toStrictEqual([
            {
                id: new RecordId("person", 1),
                firstname: "John",
                lastname: "Doe",
            },
            {
                id: new RecordId("person", 2),
                firstname: "Mary",
                lastname: "Doe",
            },
        ]);
    });

    test("range", async () => {
        const surreal = await createSurreal();
        await insertMockRecords(surreal);
        const range = await surreal.select<Person>(
            new RecordIdRange(personTable, new BoundIncluded(1), new BoundIncluded(2)),
        );

        expect(range).toStrictEqual([
            {
                id: new RecordId("person", 1),
                firstname: "John",
                lastname: "Doe",
            },
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
            .select<Person>(new RecordId("person", 1))
            .fields("age", "test", "lastname")
            .start(1)
            .limit(1)
            .where(eq("age", 30))
            .fetch("foo")
            .timeout(Duration.seconds(1))
            .version(new DateTime());

        const { query, bindings } = builder.compile();

        expect(query).toMatchSnapshot(proto("query"));
        expect(bindings).toMatchSnapshot(proto("bindings"));
    });
});
