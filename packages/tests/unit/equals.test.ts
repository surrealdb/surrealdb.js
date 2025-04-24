import { expect, test } from "bun:test";
import { equals } from "../../packages/_legacy/src";
import { createMockValue } from "./__helpers";

test("value deep equality", () => {
	const first = createMockValue();
	const second = createMockValue();

	expect(equals(first, second)).toBeTrue();
});
