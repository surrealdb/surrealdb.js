import z, { ZodType } from "npm:zod@^3.22.4";
import * as t from "./types.ts";
import { RecordId } from "../data/recordid.ts";
import { ZodTypeDef } from "./types.ts";

export const tbName: unique symbol = Symbol("tbName");

export class Field<Name extends string, Type extends ZodType> {
	readonly name: Name;
	readonly type: Type;

	constructor(name: Name, type: Type) {
		this.name = name;
		this.type = type;

		// Prevent changes
		Object.freeze(this);
	}
}

export function table<
	Name extends string,
	Fields extends Record<string, ZodType>
>(name: Name, fields: Fields) {
	// Validate that the input is correct
	const validated = z.record(z.string(), z.instanceof(ZodType)).parse(fields);

	// Map all fields to be a `Field` class
	const mappedFields = Object.fromEntries(
		Object.entries(validated).map(([name, type]) => [
			name,
			new Field(name, type),
		])
	// Fix the types, mapping objects in TypeScript is terrible...
	) as {
		readonly [K in keyof Fields]: Field<KeyToString<K>, Fields[K]>;
	};

	// Add tbName symbol and id field to the table
	const mapped = {
		[tbName]: name,
		id: new Field("id", t.recordId(name)),
		...mappedFields,
	} as const;

	// Freeze the object to prevent changes from being made
	Object.freeze(table);

	// Give a clean return type by mapping over the final result :)
	type Mapped = typeof mapped;
	return mapped as {
		readonly [K in keyof Mapped]: Mapped[K];
	};
}

export function getTableZodType<
	Name extends string,
	Fields extends GenericFields
>(schema: Table<Name, Fields>) {
	// Exclude the tbName symbol from the schema
	const { [tbName]: _, fields } = schema;

	// Reform the `Field` classes back to just the type
	const parsable = Object.fromEntries(
		Object.entries(fields).map(([name, { type }]) => [name, type])
	) as inferZodTypes<Table<Name, Fields>>;

	// Parse as object
	return z.object(parsable)
}

export function parseTableRecord<
	Name extends string,
	Fields extends GenericFields
>(schema: Table<Name, Fields>, data: unknown) {
	return getTableZodType(schema).parse(data);
}

//////////////////////
/////// TYPES ////////
//////////////////////

export type Table<Name extends string, Fields extends GenericFields> = {
	readonly [K in keyof Fields]: Fields[K];
} & {
	readonly [tbName]: Name;
	readonly id: Field<
		"id",
		ZodType<RecordId<Name>, ZodTypeDef, RecordId<Name>>
	>;
};

// Infer types from a Table type

export type inferZodTypes<Ta extends Table<string, GenericFields>> = Omit<
	{
		-readonly [F in keyof Ta]: Ta[F]["type"];
	},
	typeof tbName
>;

export type infer<Ta extends Table<string, GenericFields>> = Omit<
	{
		-readonly [F in keyof Ta]: z.infer<Ta[F]["type"]>;
	},
	typeof tbName
>;

// Generic fields

export type GenericFields = {
	[Name: string]: Field<typeof Name, ZodType>;
};

// Typescript workaround where an object with string keys, still gives back all possible object key types :(

type KeyToString<T extends string | number | symbol> = ReturnType<
	T["toString"]
>;
