import { describe, expect, test } from "bun:test";
import { RecordId } from "surrealdb";
import { type Person, setupServer } from "../__helpers__";

const { createSurreal } = await setupServer();

describe("upsert()", async () => {
	const surreal = await createSurreal();

	test("single", async () => {
		const single = await surreal.upsert<Person, Omit<Person, "id">>(
			new RecordId("person", 1),
			{
				firstname: "John",
				lastname: "Doe",
			},
		);

		expect(single).toStrictEqual({
			id: new RecordId("person", 1),
			firstname: "John",
			lastname: "Doe",
		});
	});
});
