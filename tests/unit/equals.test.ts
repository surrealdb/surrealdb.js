import { expect, test } from "bun:test";
import { createMockValue } from "./__helpers";
import { equals } from "../../src";

test("value deep equality", () => {
	const first = createMockValue();
	const second = createMockValue();

	expect(equals(first, second)).toBeTrue();
});
