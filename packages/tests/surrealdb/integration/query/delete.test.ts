import { describe, expect, test } from "bun:test";
import { DateTime, Duration, ExpressionError, RecordId, StringRecordId } from "surrealdb";
import { createSurreal, insertMockRecords, type Person, personTable, proto } from "../__helpers__";

describe("delete()", async () => {
    test("single (record id)", async () => {
        const surreal = await createSurreal();
        await insertMockRecords(surreal);
        const single = await surreal.delete<Person>(new RecordId("person", 1));

        expect(single).toStrictEqual({
            id: new RecordId("person", 1),
            firstname: "John",
            lastname: "Doe",
        });
    });

    test("single (string record id)", async () => {
        const surreal = await createSurreal();
        await insertMockRecords(surreal);
        const single = await surreal.delete<Person>(new StringRecordId("person:1"));

        expect(single).toStrictEqual({
            id: new RecordId("person", 1),
            firstname: "John",
            lastname: "Doe",
        });
    });

    test("multiple", async () => {
        const surreal = await createSurreal();
        await insertMockRecords(surreal);
        const multiple = await surreal.delete<Person>(personTable);

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

    test("compile", async () => {
        const surreal = await createSurreal();
        const builder = surreal
            .delete<Person>(personTable)
            .output("diff")
            .timeout(Duration.seconds(1));

        const { query, bindings } = builder.compile();

        expect(query).toMatchSnapshot(proto("query"));
        expect(bindings).toMatchSnapshot(proto("bindings"));
    });

    // SurrealDB has no VERSION clause for DELETE statements
    test("version() is not supported", async () => {
        const surreal = await createSurreal();
        await insertMockRecords(surreal);

        const builder = surreal.delete<Person>(personTable).version(new DateTime(0));

        expect(() => builder.compile()).toThrow(ExpressionError);
        expect(() => builder.compile()).toThrow("VERSION clause is not supported by DELETE");
        await expect(Promise.resolve(builder)).rejects.toThrow(ExpressionError);

        // Nothing was deleted
        expect(await surreal.select<Person>(personTable)).toBeArrayOfSize(2);
    });
});
