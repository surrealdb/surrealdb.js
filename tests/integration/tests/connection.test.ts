import { describe, expect, test } from "bun:test";
import {
	VersionRetrievalFailure,
	defaultVersionCheckTimeout,
} from "../../../src";
import { setupServer } from "../surreal.ts";

const { createSurreal } = await setupServer();

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
