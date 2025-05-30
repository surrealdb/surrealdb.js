import { describe, expect, test } from "bun:test";
import {
	BoundExcluded,
	BoundIncluded,
	RecordId,
	RecordIdRange,
	equals,
} from "surrealdb";
import { createMockValue } from "../__helpers__";

describe("equals()", () => {
	test("record ids", () => {
		const first = new RecordId("hello", "world");
		const second = new RecordId("hello", "world");

		expect(equals(first, second)).toBeTrue();
	});

	test("record id ranges", () => {
		const first = new RecordIdRange(
			"alphabet",
			new BoundIncluded("a"),
			new BoundExcluded("z"),
		);
		const second = new RecordIdRange(
			"alphabet",
			new BoundIncluded("a"),
			new BoundExcluded("z"),
		);

		expect(equals(first, second)).toBeTrue();
	});

	test("deep equality", () => {
		const first = createMockValue();
		const second = createMockValue();

		expect(equals(first, second)).toBeTrue();
	});
});
