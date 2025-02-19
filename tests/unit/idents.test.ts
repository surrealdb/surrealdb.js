import { describe, expect, test } from "bun:test";
import { escapeIdent } from "../../src";

describe("idents", () => {
	test("escape empty", () => {
		expect(escapeIdent("")).toBe("⟨⟩");
	});

	test("escape numeric", () => {
		expect(escapeIdent("123")).toBe("⟨123⟩");
	});

	test("escape underscore", () => {
		expect(escapeIdent("hello_world")).toBe("hello_world");
	});

	test("escape hyphen", () => {
		expect(escapeIdent("hello-world")).toBe("⟨hello-world⟩");
	});
});
