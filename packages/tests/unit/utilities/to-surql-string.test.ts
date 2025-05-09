import { describe, expect, test } from "bun:test";
import { toSurqlString } from "surrealdb";
import { createMockValue } from "../__helpers__";

describe("toSurqlString()", () => {
	test("match snapshot", () => {
		const string = toSurqlString(createMockValue());

		expect(string).toMatchSnapshot();
	});
});
