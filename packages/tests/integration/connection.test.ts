import { describe, expect, test } from "bun:test";
import { VERSION_CHECK, setupServer } from "./__helpers__";

const { createSurreal, createIdleSurreal } = await setupServer();

describe("connection", async () => {
	test.todoIf(!VERSION_CHECK)("check version", async () => {
		const surreal = await createSurreal();

		const res = await surreal.version();
		expect(res.startsWith("surrealdb-")).toBe(true);
	});

	test("allowed rpcs without namespace or database", async () => {
		const surreal = await createSurreal({
			unselected: true,
		});

		await surreal.version();
		await surreal.invalidate();
	});

	test("disallowed rpcs without namespace or database", async () => {
		const surreal = await createSurreal({
			unselected: true,
		});

		expect(async () => {
			await surreal.query("SELECT * FROM test");
		}).toThrow();
	});

	test("access selected namespace and database", async () => {
		const surreal = await createSurreal({
			unselected: true,
		});

		await surreal.use({
			namespace: "test-ns",
			database: "test-db",
		});

		expect(surreal.namespace).toBe("test-ns");
		expect(surreal.database).toBe("test-db");
	});

	test("connection status", async () => {
		const { surreal, connect } = createIdleSurreal();

		expect(surreal.status).toBe("disconnected");
		connect();
		expect(surreal.status).toBe("connecting");
		await surreal.ready;
		expect(surreal.status).toBe("connected");
		await surreal.close();
		expect(surreal.status).toBe("disconnected");
	});
});
