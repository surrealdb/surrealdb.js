import { describe, expect, test } from "bun:test";
import {
	VersionRetrievalFailure,
	defaultVersionCheckTimeout,
} from "../../../src";
import { VERSION_CHECK, setupServer } from "../surreal.ts";

const { createSurreal } = await setupServer();

describe("version check", async () => {
	test.todoIf(!VERSION_CHECK)("check version", async () => {
		const surreal = await createSurreal();

		const res = await surreal.version();
		expect(res.startsWith("surrealdb-")).toBe(true);
	});

	test.skipIf(!VERSION_CHECK)("version check timeout", async () => {
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

describe("prepare", async () => {
	test("authentication with prepare over ws", async () => {
		const surreal = await createSurreal({
			protocol: "ws",
			auth: "none",
			prepare: async (auth) => {
				await auth.signin({
					username: "root",
					password: "root",
				});
			},
		});

		await surreal.query("CREATE example");
	});

	test("authentication with prepare over http", async () => {
		const surreal = await createSurreal({
			protocol: "http",
			auth: "none",
			prepare: async (auth) => {
				await auth.signin({
					username: "root",
					password: "root",
				});
			},
		});

		await surreal.query("CREATE example");
	});
});
