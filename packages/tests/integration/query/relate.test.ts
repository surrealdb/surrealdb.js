import { describe, test, expect } from "bun:test";
import { RecordId } from "surrealdb";
import { graphTable, setupServer } from "../__helpers__";

const { createSurreal } = await setupServer();

describe("relate()", async () => {
	const surreal = await createSurreal();
	const version = await surreal.version();
	const skip = version === "surrealdb-1.4.2";

	test.skipIf(skip)("single", async () => {
		const single = await surreal.relate(
			new RecordId("edge", "in"),
			new RecordId("graph", 1),
			new RecordId("edge", "out"),
			{
				num: 123,
			},
		);

		expect(single).toStrictEqual({
			id: new RecordId("graph", 1),
			in: new RecordId("edge", "in"),
			out: new RecordId("edge", "out"),
			num: 123,
		});
	});

	test.skipIf(skip)("multiple", async () => {
		const multiple = await surreal.relate(
			new RecordId("edge", "in"),
			graphTable,
			new RecordId("edge", "out"),
			{
				id: new RecordId("graph", 2),
				num: 456,
			},
		);

		expect(multiple).toStrictEqual([
			{
				id: new RecordId("graph", 2),
				in: new RecordId("edge", "in"),
				out: new RecordId("edge", "out"),
				num: 456,
			},
		]);
	});
});
