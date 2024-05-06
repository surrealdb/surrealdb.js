import { createSurreal } from "../surreal.ts";

import { assertEquals } from "https://deno.land/std@0.223.0/assert/mod.ts";
import {
	Duration,
	GeometryCollection,
	GeometryLine,
	GeometryMultiPolygon,
	GeometryPoint,
	GeometryPolygon,
	RecordId,
	StringRecordId,
	UUID,
	uuidv4,
	uuidv7,
} from "../../../mod.ts";

type Person = {
	id: RecordId<"person">;
	firstname: string;
	lastname: string;
	age?: number;
};

Deno.test("create", async () => {
	const surreal = await createSurreal();

	const single = await surreal.create<Person, Omit<Person, "id">>(
		new RecordId("person", 1),
		{
			firstname: "John",
			lastname: "Doe",
		},
	);

	assertEquals(single, {
		id: new RecordId("person", 1),
		firstname: "John",
		lastname: "Doe",
	}, "single");

	const multiple = await surreal.create<Person>(
		"person",
		{
			id: new RecordId("person", 2),
			firstname: "Mary",
			lastname: "Doe",
		},
	);

	assertEquals(multiple, [{
		id: new RecordId("person", 2),
		firstname: "Mary",
		lastname: "Doe",
	}], "multiple");

	await surreal.close();
});

Deno.test("select", async () => {
	const surreal = await createSurreal();

	const single = await surreal.select<Person>(new RecordId("person", 1));

	assertEquals(single, {
		id: new RecordId("person", 1),
		firstname: "John",
		lastname: "Doe",
	}, "single");

	const multiple = await surreal.select<Person>("person");

	assertEquals(multiple, [
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
	], "multiple");

	await surreal.close();
});

Deno.test("merge", async () => {
	const surreal = await createSurreal();

	const single = await surreal.merge<Person>(
		new RecordId("person", 1),
		{ age: 20 },
	);

	assertEquals(single, {
		id: new RecordId("person", 1),
		firstname: "John",
		lastname: "Doe",
		age: 20,
	}, "single");

	const multiple = await surreal.merge<Person>("person", { age: 25 });

	assertEquals(multiple, [
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
	], "multiple");

	await surreal.close();
});

Deno.test("update", async () => {
	const surreal = await createSurreal();

	const single = await surreal.update<Person, Omit<Person, "id">>(
		new RecordId("person", 1),
		{
			firstname: "John",
			lastname: "Doe",
		},
	);

	assertEquals(single, {
		id: new RecordId("person", 1),
		firstname: "John",
		lastname: "Doe",
	}, "single");

	const multiple = await surreal.update<Person, Omit<Person, "id">>(
		"person",
		{
			firstname: "Mary",
			lastname: "Doe",
		},
	);

	assertEquals(multiple, [
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
	], "multiple");

	await surreal.close();
});

Deno.test("patch", async () => {
	const surreal = await createSurreal();

	const single = await surreal.patch<Person>(
		new RecordId("person", 1),
		[{ op: "replace", path: "/firstname", value: "John" }],
	);

	assertEquals(single, {
		id: new RecordId("person", 1),
		firstname: "John",
		lastname: "Doe",
	}, "single");

	const multiple = await surreal.patch<Person>(
		"person",
		[{ op: "replace", path: "/age", value: 30 }],
	);

	assertEquals(multiple, [
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
	], "multiple");

	const singleDiff = await surreal.patch(
		new RecordId("person", 1),
		[{ op: "replace", path: "/age", value: 25 }],
		true,
	);

	assertEquals(singleDiff, [
		{ op: "replace", path: "/age", value: 25 },
	], "singleDiff");

	const multipleDiff = await surreal.patch(
		"person",
		[{ op: "replace", path: "/age", value: 20 }],
		true,
	);

	assertEquals(multipleDiff, [
		[{ op: "replace", path: "/age", value: 20 }],
		[{ op: "replace", path: "/age", value: 20 }],
	], "multipleDiff");

	await surreal.close();
});

Deno.test("delete", async () => {
	const surreal = await createSurreal();

	const single = await surreal.delete<Person>(new RecordId("person", 1));

	assertEquals(single, {
		id: new RecordId("person", 1),
		firstname: "John",
		lastname: "Doe",
		age: 20,
	}, "single");

	const multiple = await surreal.delete<Person>("person");

	assertEquals(multiple, [
		{
			id: new RecordId("person", 2),
			firstname: "Mary",
			lastname: "Doe",
			age: 20,
		},
	], "multiple");

	await surreal.close();
});

Deno.test("query", async () => {
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
		uuidv4: UUID.parse(uuidv4()),
		uuidv7: UUID.parse(uuidv7()),
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
	};

	const [output] = await surreal.query<[typeof input]>(
		/* surql */ `$input`,
		{ input },
	);

	assertEquals(output, input, "datatypes");

	await surreal.close();
});

Deno.test("record id bigint", async () => {
	const surreal = await createSurreal();

	const [output] = await surreal.query<[{ id: RecordId }]>(
		/* surql */ `CREATE ONLY $id`,
		{
			id: new RecordId("person", 90071992547409915n),
		},
	);

	assertEquals(output.id.tb, "person");
	assertEquals(output.id.id, 90071992547409915n);

	await surreal.close();
});

Deno.test("string record id", async () => {
	const surreal = await createSurreal();

	const [output] = await surreal.query<[{ id: RecordId }]>(
		/* surql */ `CREATE ONLY $id`,
		{
			id: new StringRecordId("person:123"),
		},
	);

	assertEquals(output.id.tb, "person");
	assertEquals(output.id.id, 123);

	await surreal.close();
});
