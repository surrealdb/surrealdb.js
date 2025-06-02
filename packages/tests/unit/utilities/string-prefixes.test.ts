import { describe, expect, test } from "bun:test";
import { StringRecordId, Uuid, d, r, s, u } from "surrealdb";

describe("string prefixes", () => {
	test("s", () => {
		expect(s`Hello World!`).toBe("Hello World!");
		expect(s`Hello ${"World"}!`).toBe("Hello World!");
		expect(s`Hello ${"World"}! ${123}`).toBe("Hello World! 123");
	});

	test("d", () => {
		expect(d`2024-09-18T13:27:42.050Z`).toMatchObject(
			new Date("2024-09-18T13:27:42.050Z"),
		);
	});

	test("r", () => {
		expect(r`person:123`).toMatchObject(new StringRecordId("person:123"));
	});

	test("u", () => {
		expect(u`3c467084-4ac4-4938-b26a-13cadf3ab7e9`).toMatchObject(
			new Uuid("3c467084-4ac4-4938-b26a-13cadf3ab7e9"),
		);
	});
});
