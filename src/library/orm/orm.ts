import { Surreal } from "../../surreal.ts";
import { Table, GenericFields } from './schema.ts';
import { SelectQuery } from "./builder/select.ts";
import { ORMCache } from "./cache.ts";
import { RecordIdValue } from "../data/recordid.ts";

export type GenericTables = {
	[K: string]: Table<typeof K, GenericFields>
};

type ForcedString<T extends string | symbol | number> = ReturnType<T['toString']>;

export class ORM<Tables extends GenericTables> {
	readonly surreal: Surreal;
	// TODO bloody fix typescript in it's entirety (this should be Tables. Tables extends GenericTables, but once it's Tables all hell breaks loose)
	readonly cache: ORMCache<GenericTables>;
	readonly tables: Tables;

	constructor(surreal: Surreal, tables: Tables) {
		Object.freeze(tables);
		this.surreal = surreal;
		this.cache = new ORMCache();
		this.tables = tables;
	}

	select<Table extends keyof Tables>(tb: Table) {
		return new SelectQuery(this, this.tables[tb]);
	}

	// recordId<Table extends ForcedString<keyof Tables>>(tb: Table, id: RecordIdValue) {
	// 	return new AwaitableRecordId(this, tb, id);
	// }
}

export abstract class ORMAwaitable<O extends ORM<GenericTables>> implements Promise<unknown> {
	[Symbol.toStringTag] = 'ORMAwaitable';

	orm: O;
	abstract infer: unknown;
	abstract execute: () => Promise<this['infer']>;

	constructor(orm: O) {
		this.orm = orm;
	}

	catch<TResult = never>(
		onRejected?: ((reason: unknown) => TResult | PromiseLike<TResult>) | null | undefined,
	): Promise<this['infer'] | TResult> {
		return this.then(undefined, onRejected);
	}

	finally(onFinally?: (() => void) | null | undefined): Promise<this['infer']> {
		return this.then(
			(value) => {
				onFinally?.();
				return value;
			},
			(reason) => {
				onFinally?.();
				throw reason;
			},
		);
	}

	then<TResult1 = this['infer'], TResult2 = never>(
		onFulfilled?: ((value: this['infer']) => TResult1 | PromiseLike<TResult1>) | undefined | null,
		onRejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | undefined | null,
	): Promise<TResult1 | TResult2> {
		return this.execute().then(onFulfilled, onRejected);
	}
};
