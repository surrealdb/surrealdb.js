import { describe, expect, test } from "bun:test";
import { compareVersions } from "compare-versions";
import { RecordId } from "surrealdb";
import { type Person, fetchVersion, setupServer } from "../__helpers__";

const { createSurreal } = await setupServer();

describe("upsert()", async () => {
	const surreal = await createSurreal();
	const version = await fetchVersion(surreal);
	const isLegacy = compareVersions(version, "2.1.0") < 0;

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
