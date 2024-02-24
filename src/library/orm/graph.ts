import { z } from "zod";
import { QueryPart } from "./query.ts";
import { tbName, infer as inferTableTypes, getTableZodType } from "./schema.ts";
import { Table, GenericFields } from "./schema.ts";
import { GenericTables, ORM } from "./orm.ts";
import { RecordId } from "../data/recordid.ts";

export abstract class Graph<T extends Table<string, GenericFields>> extends QueryPart {
	readonly table: T;

	constructor(table: T) {
		super();
		this.table = table;
	}

	readonly inferrable = true;
	get infer() {
		type Table = inferTableTypes<T>;

		return undefined as unknown as {
			[K in keyof Table]: Table[K];
		}[];
	}

	validator() {
		return z.array(getTableZodType(this.table));
	}

	cacher<O extends ORM<GenericTables>>(orm: O, input: this['infer']): void {
		input.forEach((document) => {
			const { tb, id } = document.id as RecordId<T[typeof tbName]>;
			orm.cache.set(tb, id, document);
		});
	}
};
export class GraphTo<T extends Table<string, GenericFields>> extends Graph<T> {
	display(): string {
		return `->${this.table[tbName]}`;
	}
}

export class GraphFrom<T extends Table<string, GenericFields>> extends Graph<T> {
	display(): string {
		return `<-${this.table[tbName]}`;
	}
}

export function to<T extends Table<string, GenericFields>>(field: T) {
	return new GraphTo(field);
}

export function from<T extends Table<string, GenericFields>>(field: T) {
	return new GraphFrom(field);
}
