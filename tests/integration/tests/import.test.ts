import { describe, expect, test } from "bun:test";
import { setupServer } from "../surreal.ts";
import { fetchVersion } from "../helpers.ts";
import { compareVersions } from "compare-versions";

const { createSurreal } = await setupServer();

describe("import", async () => {
	const surreal = await createSurreal();
	const version = await fetchVersion(surreal);
	const runTest = compareVersions(version, "2.0.0") >= 0;

	test.if(runTest)("basic", async () => {
		await surreal.import(/* surql */ `
			CREATE foo:1 CONTENT { hello: "world" };
		`);

		const res = await surreal.query(/* surql */ `
			SELECT * FROM foo;
		`);

		expect(res).toMatchSnapshot();
	});
});
