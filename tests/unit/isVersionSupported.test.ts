import { describe, expect, test } from "bun:test";
import { isVersionSupported } from "../../src/util/versionCheck.ts";

describe("isVersionSupported", () => {
	test("1.0.0 should be unsupported", () => {
		expect(isVersionSupported("1.0.0")).toBe(false);
	});

	test("1.4.1 should be unsupported", () => {
		expect(isVersionSupported("1.4.1")).toBe(false);
	});

	test("1.4.2 should be supported", () => {
		expect(isVersionSupported("1.4.2")).toBe(true);
	});

	test("1.99.99 should be supported", () => {
		expect(isVersionSupported("1.99.99")).toBe(true);
	});

	test("3.0.0 should be unsupported", () => {
		expect(isVersionSupported("3.0.0")).toBe(false);
	});
});
