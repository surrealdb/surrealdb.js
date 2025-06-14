import { describe, expect, test } from "bun:test";
import { RecordId } from "surrealdb";
import {
	type Person,
	insertMockRecords,
	personTable,
	setupServer,
} from "../__helpers__";

const { createSurreal } = await setupServer();

describe("merge()", async () => {
	const surreal = await createSurreal();

	await insertMockRecords(surreal);

	test("single", async () => {
		const single = await surreal.merge<Person>(new RecordId("person", 1), {
			age: 20,
		});

		expect(single).toStrictEqual({
			id: new RecordId("person", 1),
			firstname: "John",
			lastname: "Doe",
			age: 20,
		});
	});

	test("multiple", async () => {
		const multiple = await surreal.merge<Person>(personTable, { age: 25 });

		expect(multiple).toStrictEqual([
			{
				id: new RecordId("person", 1),
				firstname: "John",
				lastname: "Doe",
				age: 25,
			},
			{
				id: new RecordId("person", 2),
				firstname: "Mary",
				lastname: "Doe",
				age: 25,
			},
		]);
	});
});
