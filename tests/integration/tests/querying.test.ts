import { describe, expect, test } from "bun:test";
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
	decodeCbor,
	encodeCbor,
	surql,
} from "../../../src";
import {
	BoundExcluded,
	BoundIncluded,
	Range,
	RecordIdRange,
} from "../../../src/data/types/range.ts";
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

	test("range", async () => {
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
	const version = await surreal.version();
	if (version.startsWith("surrealdb-1")) return;

	test("single", async () => {
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

	test("multiple", async () => {
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
	if (version === "surrealdb-1.4.2") return;

	test("single", async () => {
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

	test("multiple", async () => {
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

test("run", async () => {
	const surreal = await createSurreal();
	const version = await surreal.version();
	if (version === "surrealdb-1.4.2") return;

	const res = await surreal.run<number[]>("array::add", [[1, 2], 3]);
	expect(res).toMatchObject([1, 2, 3]);
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
});

test("query", async () => {
	const surreal = await createSurreal();

	const input = {
		// Native
		string: "Hello World!",
		number: 123,
		float: 123.456,
		true: true,
		false: false,
		null: null,
		undefined: undefined,
		array: [123],
		object: { num: 456 },
		date: new Date(),

		// Custom
		// Decimals are currently bugged on SurrealDB side of decoding
		// decimal: new Decimal("123.456"),
		rid: new RecordId("some-custom", [
			"recordid",
			{ with_an: "object" },
			undefined,
		]),
		uuidv4: Uuid.v4(),
		uuidv7: Uuid.v7(),
		duration: new Duration("1w1d1h1s1ms"),
		geometries: new GeometryCollection([
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
		range: new Range(new BoundIncluded(1), new BoundExcluded(5)),
		range_unbounded: new Range(new BoundIncluded(1), undefined),
		rid_range: new RecordIdRange(
			"test",
			new BoundIncluded(1),
			new BoundExcluded(5),
		),
	};

	const [output] = await surreal.query<[typeof input]>(/* surql */ "$input", {
		input,
	});

	expect(output).toStrictEqual(input);
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
