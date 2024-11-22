import { describe, expect, test } from "bun:test";
import { setupServer } from "../surreal.ts";
import type Surreal from "../../../src";

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
	await surreal.query('UPSERT foo:1 CONTENT { hello: "world" }');
	await surreal.query('UPSERT bar:1 CONTENT { hello: "world" }');
	await surreal.query('DEFINE FUNCTION OVERWRITE fn::foo() { RETURN "bar"; }');

	test("basic", async () => {
		const res = await surreal.export();

		expect(res).toMatchSnapshot();
	});

	test("filter tables", async () => {
		const res = await surreal.export({
			tables: ["foo"],
		});

		expect(res).toMatchSnapshot();
	});

	test("filter functions", async () => {
		const res = await surreal.export({
			functions: true,
			tables: false,
		});

		expect(res).toMatchSnapshot();
	});
}
