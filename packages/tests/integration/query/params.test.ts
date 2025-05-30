import { describe, expect, test } from "bun:test";
import { setupServer } from "../__helpers__";

const { createSurreal } = await setupServer();

describe("let() / unset()", async () => {
	const surreal = await createSurreal();

	test("define param", async () => {
		await surreal.let("hello", "world");

		const [result] = await surreal.query<[string]>("RETURN $hello");

		expect(result).toBe("world");
	});

	test("unset param", async () => {
		await surreal.unset("hello");

		const [result] = await surreal.query<[string]>("RETURN $hello");

		expect(result).toBeUndefined();
	});

	test("retrieve state", async () => {
		await surreal.let("foo", "bar");

		expect(surreal.parameters).toMatchObject({
			foo: "bar",
		});
	});
});
