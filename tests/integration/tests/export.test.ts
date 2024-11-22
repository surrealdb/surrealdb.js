import { beforeAll, describe, expect, test } from "bun:test";
import { setupServer } from "../surreal.ts";
import { compareVersions } from "compare-versions";
import { surql } from "../../../src";

const { createSurreal } = await setupServer();

beforeAll(async () => {
	const surreal = await createSurreal();

	await surreal.query(surql`
		CREATE foo:1 CONTENT { hello: "world" };
		CREATE bar:1 CONTENT { hello: "world" };
		DEFINE FUNCTION fn::foo() { RETURN "bar"; };
	`);
});

describe("export", async () => {
	const surreal = await createSurreal();
	const version = (await surreal.version()).replace(/^surrealdb-/, "");
	const hasPostExport = compareVersions(version, "2.1.0") >= 0;

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
});
