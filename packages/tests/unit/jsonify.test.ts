import { expect, test } from "bun:test";
import { jsonify } from "../../packages/_legacy/src";
import { createMockValue } from "./__helpers";

test("jsonify matches snapshot", () => {
	const json = jsonify(createMockValue());

	expect(json).toMatchSnapshot();
});
