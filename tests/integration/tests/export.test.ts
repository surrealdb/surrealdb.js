import { describe, expect, test } from "bun:test";
import type Surreal from "../../../src";
import { setupServer } from "../surreal.ts";
import { compareVersions } from "compare-versions";

const { createSurreal } = await setupServer();

describe("http export", async () => {
	const surreal = await createSurreal({
		protocol: "http",
	});

	await runExportTests(surreal);
});

describe("ws export", async () => {
	const surreal = await createSurreal({
		protocol: "ws",
	});

	await runExportTests(surreal);
});

async function runExportTests(surreal: Surreal) {
	const version = (await surreal.version()).replace(/^surrealdb-/, "");
	const hasPostExport = compareVersions(version, "2.1.0") >= 0;

	await surreal.query('UPSERT foo:1 CONTENT { hello: "world" }');
	await surreal.query('UPSERT bar:1 CONTENT { hello: "world" }');
	await surreal.query('DEFINE FUNCTION OVERWRITE fn::foo() { RETURN "bar"; }');

	test.if(hasPostExport)("basic", async () => {
		const res = await surreal.export();

		expect(res).toMatchSnapshot();
	});

	test.if(hasPostExport)("filter tables", async () => {
		const res = await surreal.export({
			tables: ["foo"],
		});

		expect(res).toMatchSnapshot();
	});

	test.if(hasPostExport)("filter functions", async () => {
		const res = await surreal.export({
			functions: true,
			tables: false,
		});

		expect(res).toMatchSnapshot();
	});
}
