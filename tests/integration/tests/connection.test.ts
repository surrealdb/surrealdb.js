import {
	VersionRetrievalFailure,
	defaultVersionCheckTimeout,
} from "../../../src";

import { describe, expect, test } from "bun:test";
import { spawnTestServer } from "../surreal.ts";

const { createSurreal } = await spawnTestServer();

describe("version check", async () => {
	test("check version", async () => {
		const surreal = await createSurreal();

		const res = await surreal.version();
		expect(res.startsWith("surrealdb-")).toBe(true);
	});

	test("version check timeout", async () => {
		const start = new Date();
		const res = createSurreal({ reachable: false });
		const end = new Date();
		const diff = end.getTime() - start.getTime();

		expect(res).rejects.toBeInstanceOf(VersionRetrievalFailure);
		expect(diff).toBeLessThanOrEqual(defaultVersionCheckTimeout + 100); // 100ms margin
	});
});

describe("rpc", async () => {
	test("allowed rpcs without namespace or database", async () => {
		const surreal = await createSurreal({
			unselected: true,
			protocol: "http",
		});

		await surreal.version();
		await surreal.invalidate();
	});

	test("disallowed rpcs without namespace or database", async () => {
		const surreal = await createSurreal({
			unselected: true,
			protocol: "http",
		});

		expect(async () => {
			await surreal.query("SELECT * FROM test");
		}).toThrow();
	});
});
