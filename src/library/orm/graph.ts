import { z } from "npm:zod@^3.22.4";
import { QueryPart } from "./query.ts";
import { tbName, infer as inferTableTypes, getTableZodType } from "./schema.ts";
import { Table, GenericFields } from "./schema.ts";
import { ZodType } from "./types.ts";

export abstract class Graph extends QueryPart {};
export class GraphTo<T extends Table<string, GenericFields>> extends Graph {
	readonly table: T;

	constructor(table: T) {
		super();
		this.table = table;
	}

	display(): string {
		return `->${this.table[tbName]}`;
	}

	readonly inferrable = true;
	get infer() {
		type Table = inferTableTypes<T>;

		return undefined as unknown as {
			[K in keyof Table]: Table[K];
		}[];
	}

	validator() {
		return z.array(getTableZodType(this.table)) as ZodType<this['infer']>;
	}
}

export class GraphFrom<T extends Table<string, GenericFields>> extends Graph {
	readonly table: T;

	constructor(table: T) {
		super();
		this.table = table;
	}

	display(): string {
		return `<-${this.table[tbName]}`;
	}

	readonly inferrable = true;
	get infer() {
		type Table = inferTableTypes<T>;

		return undefined as unknown as {
			[K in keyof Table]: Table[K];
		}[];
	}

	validator() {
		return z.array(getTableZodType(this.table)) as ZodType<this['infer']>;
	}
}

export function to<T extends Table<string, GenericFields>>(field: T) {
	return new GraphTo(field);
}

export function from<T extends Table<string, GenericFields>>(field: T) {
	return new GraphFrom(field);
}
