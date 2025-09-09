import { describe, expect, test } from "bun:test";
import { jsonify } from "surrealdb";
import { createMockValue } from "../__helpers__";

describe("jsonify()", () => {
    test("match snapshot", () => {
        const json = jsonify(createMockValue());

        expect(json).toMatchSnapshot();
    });
});
