import { describe, expect, test } from "bun:test";
import { compareVersions } from "compare-versions";
import {
	Duration,
	Gap,
	GeometryCollection,
	GeometryLine,
	GeometryMultiPolygon,
	GeometryPoint,
	GeometryPolygon,
	RecordId,
	StringRecordId,
	Table,
	Uuid,
	surql,
} from "../../../src";
import {
	BoundExcluded,
	BoundIncluded,
	Range,
	RecordIdRange,
} from "../../../src/data/types/range.ts";
import { fetchVersion } from "../helpers.ts";
import { setupServer } from "../surreal.ts";

const { createSurreal } = await setupServer();

type Person = {
	id: RecordId<"person">;
	firstname: string;
	lastname: string;
	age?: number;
};

describe("create", async () => {
	const surreal = await createSurreal();

	test("single", async () => {
		const single = await surreal.create<Person, Omit<Person, "id">>(
			new RecordId("person", 1),
			{
				firstname: "John",
				lastname: "Doe",
			},
		);

		expect(single).toStrictEqual({
			id: new RecordId("person", 1),
			firstname: "John",
			lastname: "Doe",
		});
	});

	test("multiple", async () => {
		const multiple = await surreal.create<Person>("person", {
			id: new RecordId("person", 2),
			firstname: "Mary",
			lastname: "Doe",
		});

		expect(multiple).toStrictEqual([
			{
				id: new RecordId("person", 2),
				firstname: "Mary",
				lastname: "Doe",
			},
		]);
	});
});

describe("select", async () => {
	const surreal = await createSurreal();
	const version = await surreal.version();

	test("single", async () => {
		const single = await surreal.select<Person>(new RecordId("person", 1));

		expect(single).toStrictEqual({
			id: new RecordId("person", 1),
			firstname: "John",
			lastname: "Doe",
		});
	});

	test("multiple", async () => {
		const multiple = await surreal.select<Person>("person");

		expect(multiple).toStrictEqual([
			{
				id: new RecordId("person", 1),
				firstname: "John",
				lastname: "Doe",
			},
			{
				id: new RecordId("person", 2),
				firstname: "Mary",
				lastname: "Doe",
			},
		]);
	});

	test.skipIf(version.startsWith("surrealdb-1"))("range", async () => {
		const range = await surreal.select<Person>(
			new RecordIdRange("person", new BoundIncluded(1), new BoundIncluded(2)),
		);

		expect(range).toStrictEqual([
			{
				id: new RecordId("person", 1),
				firstname: "John",
				lastname: "Doe",
			},
			{
				id: new RecordId("person", 2),
				firstname: "Mary",
				lastname: "Doe",
			},
		]);
	});
});

describe("merge", async () => {
	const surreal = await createSurreal();

	test("single", async () => {
		const single = await surreal.merge<Person>(new RecordId("person", 1), {
			age: 20,
		});

		expect(single).toStrictEqual({
			id: new RecordId("person", 1),
			firstname: "John",
			lastname: "Doe",
			age: 20,
		});
	});

	test("multiple", async () => {
		const multiple = await surreal.merge<Person>("person", { age: 25 });

		expect(multiple).toStrictEqual([
			{
				id: new RecordId("person", 1),
				firstname: "John",
				lastname: "Doe",
				age: 25,
			},
			{
				id: new RecordId("person", 2),
				firstname: "Mary",
				lastname: "Doe",
				age: 25,
			},
		]);
	});
});

describe("update", async () => {
	const surreal = await createSurreal();

	test("single", async () => {
		const single = await surreal.update<Person, Omit<Person, "id">>(
			new RecordId("person", 1),
			{
				firstname: "John",
				lastname: "Doe",
			},
		);

		expect(single).toStrictEqual({
			id: new RecordId("person", 1),
			firstname: "John",
			lastname: "Doe",
		});
	});

	test("multiple", async () => {
		const multiple = await surreal.update<Person, Omit<Person, "id">>(
			"person",
			{
				firstname: "Mary",
				lastname: "Doe",
			},
		);

		expect(multiple).toStrictEqual([
			{
				id: new RecordId("person", 1),
				firstname: "Mary",
				lastname: "Doe",
			},
			{
				id: new RecordId("person", 2),
				firstname: "Mary",
				lastname: "Doe",
			},
		]);
	});
});

describe("upsert", async () => {
	const surreal = await createSurreal();
	const version = await fetchVersion(surreal);
	const hasUpsert = compareVersions(version, "2.0.0") >= 0;
	const isLegacy = compareVersions(version, "2.1.0") < 0;

	test.if(hasUpsert)("single", async () => {
		const single = await surreal.upsert<Person, Omit<Person, "id">>(
			new RecordId("person", 1),
			{
				firstname: "John",
				lastname: "Doe",
			},
		);

		expect(single).toStrictEqual({
			id: new RecordId("person", 1),
			firstname: "John",
			lastname: "Doe",
		});
	});

	test.if(hasUpsert && isLegacy)("multiple (legacy)", async () => {
		const multiple = await surreal.upsert<Person, Omit<Person, "id">>(
			"person",
			{
				firstname: "Mary",
				lastname: "Doe",
			},
		);

		expect(multiple).toStrictEqual([
			{
				id: new RecordId("person", 1),
				firstname: "Mary",
				lastname: "Doe",
			},
			{
				id: new RecordId("person", 2),
				firstname: "Mary",
				lastname: "Doe",
			},
		]);
	});
});

describe("patch", async () => {
	const surreal = await createSurreal();

	test("single", async () => {
		const single = await surreal.patch<Person>(new RecordId("person", 1), [
			{ op: "replace", path: "/firstname", value: "John" },
		]);

		expect(single).toStrictEqual({
			id: new RecordId("person", 1),
			firstname: "John",
			lastname: "Doe",
		});
	});

	test("multiple", async () => {
		const multiple = await surreal.patch<Person>("person", [
			{ op: "replace", path: "/age", value: 30 },
		]);

		expect(multiple).toStrictEqual([
			{
				id: new RecordId("person", 1),
				firstname: "John",
				lastname: "Doe",
				age: 30,
			},
			{
				id: new RecordId("person", 2),
				firstname: "Mary",
				lastname: "Doe",
				age: 30,
			},
		]);
	});

	test("single diff", async () => {
		const singleDiff = await surreal.patch(
			new RecordId("person", 1),
			[{ op: "replace", path: "/age", value: 25 }],
			true,
		);

		expect(singleDiff).toStrictEqual([
			{ op: "replace", path: "/age", value: 25 },
		]);
	});

	test("multiple diff", async () => {
		const multipleDiff = await surreal.patch(
			"person",
			[{ op: "replace", path: "/age", value: 20 }],
			true,
		);

		expect(multipleDiff).toStrictEqual([
			[{ op: "replace", path: "/age", value: 20 }],
			[{ op: "replace", path: "/age", value: 20 }],
		]);
	});
});

describe("delete", async () => {
	const surreal = await createSurreal();

	test("single", async () => {
		const single = await surreal.delete<Person>(new RecordId("person", 1));

		expect(single).toStrictEqual({
			id: new RecordId("person", 1),
			firstname: "John",
			lastname: "Doe",
			age: 20,
		});
	});

	test("multiple", async () => {
		const multiple = await surreal.delete<Person>("person");

		expect(multiple).toStrictEqual([
			{
				id: new RecordId("person", 2),
				firstname: "Mary",
				lastname: "Doe",
				age: 20,
			},
		]);
	});
});

describe("relate", async () => {
	const surreal = await createSurreal();
	const version = await surreal.version();
	const skip = version === "surrealdb-1.4.2";

	test.skipIf(skip)("single", async () => {
		const single = await surreal.relate(
			new RecordId("edge", "in"),
			new RecordId("graph", 1),
			new RecordId("edge", "out"),
			{
				num: 123,
			},
		);

		expect(single).toStrictEqual({
			id: new RecordId("graph", 1),
			in: new RecordId("edge", "in"),
			out: new RecordId("edge", "out"),
			num: 123,
		});
	});

	test.skipIf(skip)("multiple", async () => {
		const multiple = await surreal.relate(
			new RecordId("edge", "in"),
			"graph",
			new RecordId("edge", "out"),
			{
				id: new RecordId("graph", 2),
				num: 456,
			},
		);

		expect(multiple).toStrictEqual([
			{
				id: new RecordId("graph", 2),
				in: new RecordId("edge", "in"),
				out: new RecordId("edge", "out"),
				num: 456,
			},
		]);
	});
});

describe("run", async () => {
	const surreal = await createSurreal();
	const version = await surreal.version();
	const skip = version === "surrealdb-1.4.2";

	test.skipIf(skip)("run", async () => {
		const res = await surreal.run<number[]>("array::add", [[1, 2], 3]);
		expect(res).toMatchObject([1, 2, 3]);
	});
});

describe("template literal", async () => {
	const surreal = await createSurreal();

	test("with gap", async () => {
		const name = new Gap();
		const query = surql`CREATE ONLY person:test SET name = ${name}`;
		const res = await surreal.query(query, [name.fill("test")]);
		expect(res).toStrictEqual([
			{
				id: new RecordId("person", "test"),
				name: "test",
			},
		]);
	});

	test("with defined connection variables", async () => {
		await surreal.let("test1", 123);
		const gap = new Gap<number>();
		const query = surql`RETURN [$test1, ${456}, ${gap}]`;
		const res = await surreal.query(query, [gap.fill(789)]);
		expect(res).toStrictEqual([[123, 456, 789]]);
	});

	test("has replacer context", async () => {
		const id = new RecordId("test", 123);
		const query = surql`RETURN ${id}`;
		const res = await surreal.query(query);
		expect(res).toStrictEqual([id]);
	});

	test("appended", async () => {
		// Create the initial prepared query
		const name = new Gap();
		const query = surql`CREATE ONLY person:append SET name = ${name}`;

		// Append to it
		const age = new Gap();
		query.append`, age = ${age}`;

		// Check result
		const res = await surreal.query(query, [name.fill("append"), age.fill(20)]);

		expect(res).toStrictEqual([
			{
				id: new RecordId("person", "append"),
				name: "append",
				age: 20,
			},
		]);
	});

	test("reused gap", async () => {
		const foo = new Gap();
		const bar = new Gap();
		const query = surql`RETURN [${foo}, ${bar}, ${1}, ${foo}, ${bar}, ${2}]`;
		expect(Object.keys(query.bindings)).toStrictEqual([
			"bind___0",
			"bind___1",
			"bind___2",
			"bind___3",
		]);

		// Ensure appended segments also re-use
		query.append`; RETURN [${foo}, ${bar}, ${1}, ${foo}, ${bar}, ${2}]`;
		expect(Object.keys(query.bindings)).toStrictEqual([
			"bind___0",
			"bind___1",
			"bind___2",
			"bind___3",
			"bind___4",
			"bind___5",
			"bind___6",
			"bind___7",
		]);

		// Check result
		const res = await surreal.query(query, [foo.fill("a"), bar.fill("b")]);

		expect(res).toStrictEqual([
			["a", "b", 1, "a", "b", 2],
			["a", "b", 1, "a", "b", 2],
		]);
	});
});

describe("value encoding/decoding", async () => {
	const surreal = await createSurreal();
	const version = await surreal.version();

	const testValue = (
		name: string,
		input: unknown,
		cond?: boolean,
		todo?: boolean,
	) => {
		const runner = todo ? test.todoIf(true) : test.if(cond ?? true);
		runner(name, async () => {
			const [output] = await surreal.query<[typeof input]>(
				/* surql */ "$input",
				{
					input,
				},
			);

			expect(output).toStrictEqual(input);
		});
	};

	// Native values

	describe("native", () => {
		testValue("string", "Hello World!");
		testValue("number", 123);
		testValue("float", 123.456);
		testValue("true", true);
		testValue("false", false);
		testValue("null", null);
		testValue("undefined", undefined);
		testValue("array", [123]);
		testValue("object", { num: 456 });
		testValue("date", new Date());
	});

	// Custom values

	testValue("UUID v4", Uuid.v4());
	testValue("UUID v7", Uuid.v7());
	testValue("Duration", new Duration("1w1d1h1s1ms"));

	testValue(
		"Record ID",
		new RecordId("some-custom", ["recordid", { with_an: "object" }, undefined]),
	);

	testValue(
		"Geometries",
		new GeometryCollection([
			new GeometryPoint([1, 2]),
			new GeometryMultiPolygon([
				new GeometryPolygon([
					new GeometryLine([
						new GeometryPoint([1, 2]),
						new GeometryPoint([3, 4]),
					]),
					new GeometryLine([
						new GeometryPoint([5, 6]),
						new GeometryPoint([7, 8]),
					]),
				]),
			]),
		]),
	);

	// Ranges

	testValue(
		"Range",
		new Range(new BoundIncluded(1), new BoundExcluded(5)),
		version.startsWith("surrealdb-2"),
	);

	testValue(
		"Range Unbounded",
		new Range(new BoundIncluded(1), undefined),
		version.startsWith("surrealdb-2"),
	);

	testValue(
		"Record ID Range",
		new RecordIdRange("test", new BoundIncluded(1), new BoundExcluded(5)),
		version.startsWith("surrealdb-2"),
	);
});

test("record id bigint", async () => {
	const surreal = await createSurreal();

	const [output] = await surreal.query<[{ id: RecordId }]>(
		/* surql */ "CREATE ONLY $id",
		{
			id: new RecordId("person", 90071992547409915n),
		},
	);

	expect(output.id).toStrictEqual(new RecordId("person", 90071992547409915n));
});

test("string record id", async () => {
	const surreal = await createSurreal();

	const [output] = await surreal.query<[{ id: RecordId }]>(
		/* surql */ "CREATE ONLY $id",
		{
			id: new StringRecordId("person:123"),
		},
	);

	expect(output.id).toStrictEqual(new RecordId("person", 123));
});

test("table", async () => {
	const surreal = await createSurreal();

	const [output] = await surreal.query<[Table]>(
		/* surql */ "RETURN type::table($table)",
		{
			table: "person",
		},
	);

	expect(output).toStrictEqual(new Table("person"));
});
