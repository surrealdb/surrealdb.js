import { expect, test } from "bun:test";
import { jsonify } from "@surrealdb/legacy";
import { createMockValue } from "./__helpers";

test("jsonify matches snapshot", () => {
	const json = jsonify(createMockValue());

	expect(json).toMatchSnapshot();
});
