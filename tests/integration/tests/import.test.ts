import { describe, expect, test } from "bun:test";
import { setupServer } from "../surreal.ts";

const { createSurreal } = await setupServer();

describe("import", async () => {
	const surreal = await createSurreal();

	test("basic", async () => {
		await surreal.import(/* surql */ `
			CREATE foo:1 CONTENT { hello: "world" };
		`);

		const res = await surreal.query(/* surql */ `
			SELECT * FROM foo;
		`);

		expect(res).toMatchSnapshot();
	});
});
