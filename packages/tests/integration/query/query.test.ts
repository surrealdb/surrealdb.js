import { beforeAll, describe, expect, test } from "bun:test";
import { RecordId, surql } from "surrealdb";
import { setupServer } from "../__helpers__";

const { createSurreal } = await setupServer();

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
});
