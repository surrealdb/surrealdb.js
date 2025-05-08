import { describe, test, expect } from "bun:test";
import { RecordId } from "surrealdb";
import { setupServer, type Person } from "../__helpers__";

const { createSurreal } = await setupServer();

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
});
