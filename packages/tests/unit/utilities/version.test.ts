import { describe, expect, test } from "bun:test";
import { isVersionSupported } from "surrealdb";

describe("isVersionSupported()", () => {
	test("1.0.0 should be unsupported", () => {
		expect(isVersionSupported("1.0.0")).toBe(false);
	});

	test("1.5.6 should be unsupported", () => {
		expect(isVersionSupported("1.5.6")).toBe(false);
	});

	test("2.0.0 should be supported", () => {
		expect(isVersionSupported("2.0.0")).toBe(true);
	});

	test("3.0.0 should be supported", () => {
		expect(isVersionSupported("3.0.0")).toBe(true);
	});

	test("3.99.99 should be supported", () => {
		expect(isVersionSupported("3.99.99")).toBe(true);
	});

	test("4.0.0 should be unsupported", () => {
		expect(isVersionSupported("4.0.0")).toBe(false);
	});
});
