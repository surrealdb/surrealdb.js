import { describe, expect, test } from "bun:test";
import { BoundIncluded, RecordId, RecordIdRange } from "surrealdb";
import {
	type Person,
	insertMockRecords,
	personTable,
	setupServer,
} from "../__helpers__";

const { createSurreal } = await setupServer();

describe("select()", async () => {
	const surreal = await createSurreal();

	await insertMockRecords(surreal);

	test("single", async () => {
		const single = await surreal.select<Person>(new RecordId("person", 1));

		expect(single).toStrictEqual({
			id: new RecordId("person", 1),
			firstname: "John",
			lastname: "Doe",
		});
	});

	test("multiple", async () => {
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
		const range = await surreal.select<Person>(
			new RecordIdRange(
				personTable,
				new BoundIncluded(1),
				new BoundIncluded(2),
			),
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
});
