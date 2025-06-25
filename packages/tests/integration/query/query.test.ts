import { describe, expect, test } from "bun:test";
import { Gap } from "@surrealdb/cbor";
import { surql } from "surrealdb";
import { setupServer } from "../__helpers__";

const { createSurreal } = await setupServer();

describe("query()", async () => {
	const surreal = await createSurreal();

	test("direct query", async () => {
		const [result] = await surreal.query<["foo"]>(`RETURN "foo"`);

		expect(result).toEqual("foo");
	});

	test("prepared query", async () => {
		const gap = new Gap();
		const query = surql`
			RETURN ${gap}
		`;

		const [result] = await surreal.query<["foo"]>(query, [gap.fill("foo")]);

		expect(result).toEqual("foo");
	});

	test("direct raw query", async () => {
		const [result] = await surreal.query<["foo"]>(`RETURN "foo"`).raw();

		expect(result.status).toEqual("OK");
		expect(result.result).toEqual("foo");
	});

	test("prepared raw query", async () => {
		const gap = new Gap();
		const query = surql`
			RETURN ${gap}
		`;

		const [result] = await surreal
			.query<["foo"]>(query, [gap.fill("foo")])
			.raw();

		expect(result.status).toEqual("OK");
		expect(result.result).toEqual("foo");
	});
});
