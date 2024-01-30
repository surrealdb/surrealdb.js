import { Surreal } from "../../../surreal.ts";
import { RecordIdValue } from "../../data/recordid.ts";
import { Table, GenericFields } from '../schema.ts';
import { SelectQuery } from "./select.ts";

export type GenericTables = {
	[K: string]: Table<typeof K, GenericFields>
};

export class ORM<Tables extends GenericTables> {
	readonly surreal: Surreal;
	readonly tables: Tables;

	constructor(surreal: Surreal, tables: Tables) {
		Object.freeze(tables);
		this.surreal = surreal;
		this.tables = tables;
	}

	select<Table extends keyof Tables>(tb: Table, id?: RecordIdValue) {
		return new SelectQuery(this.surreal, this.tables[tb], id);
	}
}
