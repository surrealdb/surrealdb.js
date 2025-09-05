import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { RecordId, surql } from "surrealdb";
import { resetIncrementalID } from "../../../sdk/src/internal/get-incremental-id";
import { type Person, setupServer } from "../__helpers__";

const { createSurreal } = await setupServer();

beforeEach(async () => {
    resetIncrementalID();
});

beforeAll(async () => {
    const surreal = await createSurreal();

    await surreal.query(/* surql */ `
		CREATE |foo:1..100| CONTENT { hello: "world" };
	`);
});

describe("query()", async () => {
    const surreal = await createSurreal();

    test("direct query", async () => {
        await surreal.query(`UPSERT hello:world CONTENT { hello: "world" }`);
    });

    test("collect query results", async () => {
        const [result] = await surreal.query(`RETURN hello:world.hello`).collect<["world"]>();

        expect(result).toEqual("world");
    });

    test("collect specific query results", async () => {
        const [first, third] = await surreal
            .query(`RETURN 1; RETURN 2; RETURN 3`)
            .collect<[1, 3]>(0, 2);

        expect(first).toEqual(1);
        expect(third).toEqual(3);
    });

    test("stream query results", async () => {
        const stream = surreal.query(`SELECT * FROM foo`).stream();

        let valueCount = 0;
        let doneCount = 0;
        let errorCount = 0;

        for await (const frame of stream) {
            if (frame.isValue<{ hello: string }>()) {
                expect(frame.value.hello).toEqual("world");
                valueCount++;
            } else if (frame.isDone()) {
                doneCount++;
            } else if (frame.isError()) {
                errorCount++;
            }
        }

        expect(valueCount).toEqual(100);
        expect(doneCount).toEqual(1);
        expect(errorCount).toEqual(0);
    });

    test("bound query", async () => {
        const record = new RecordId("hello", "world");
        const query = surql`
			RETURN ${record}
		`;

        const [result] = await surreal.query(query).collect<[RecordId]>();

        expect(result.equals(record)).toBeTrue();
    });

    test("inner query", async () => {
        const record = new RecordId("hello", "world");
        const { query, bindings } = surreal.query(surql`RETURN ${record}`).inner;

        expect(query).toMatchSnapshot();
        expect(bindings).toMatchSnapshot();
    });

    test("pre compiled", async () => {
        const compiled = surreal
            .create<Person>(new RecordId("person", 2), {
                firstname: "Mary",
                lastname: "Doe",
            })
            .compile();

        const [result] = await surreal.query(compiled).collect();

        expect(result).toMatchObject({
            firstname: "Mary",
            lastname: "Doe",
        });
    });
});
