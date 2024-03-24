import { ZodType } from "zod";
import { PreparedQuery } from "../PreparedQuery";
import { Field, GenericFields, Table, getTableZodType, tbName } from "./schema";
import { ZodRecordId } from "./types";

export function generateTable<T extends Table<string, GenericFields>>(table: T) {
	const name = table[tbName];
	const fields = getTableZodType(table);
	const statements: PreparedQuery[] = [];

	statements.push(new PreparedQuery(`DEFINE TABLE $name SCHEMAFULL`, { name }));
}

export function generatorField<T extends Field<string, ZodType>>({ name, type }: T) {
	if (type instanceof ZodRecordId) {
		return
	}
}
