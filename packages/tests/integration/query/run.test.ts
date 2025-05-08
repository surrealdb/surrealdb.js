import { describe, test, expect } from "bun:test";
import { setupServer } from "../__helpers__";

const { createSurreal } = await setupServer();

describe("run()", async () => {
	const surreal = await createSurreal();

	test("run", async () => {
		const res = await surreal.run<number[]>("array::add", [[1, 2], 3]);
		expect(res).toMatchObject([1, 2, 3]);
	});
});
