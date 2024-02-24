import { RecordId } from "../../data/recordid.ts";
import { Filter } from "../filters.ts";
import {
	tbName,
	GenericFields,
	Table,
	infer as inferTableTypes,
	getTableZodType,
} from "../schema.ts";
import { Query, QueryPart } from "../query.ts";
import { DisplayUtils } from "../display.ts";
import { z } from "zod";
import { ORM, GenericTables } from '../orm.ts';

type SideEffects = Record<string, QueryPart>;

export class SelectQuery<
	O extends ORM<GenericTables>,
	T extends Table<string, GenericFields>,
	S extends SideEffects = SideEffects
> extends Query<O> {
	readonly tb: T;
	private _filter?: Filter;
	private _start?: number;
	private _limit?: number;
	private _sideEffects: S = {} as S;
	orm: O;

	constructor(orm: O, tb: T) {
		super();
		this.orm = orm;
		this.tb = tb;
	}

	where(filter: Filter) {
		if (this._filter) throw new Error("Cannot redefine filters");
		this._filter = filter;
		return this;
	}

	start(start: number) {
		this._start = start;
		return this;
	}

	limit(limit: number) {
		this._limit = limit;
		return this;
	}

	sideEffect<Name extends string, Part extends QueryPart>(
		name: Name,
		part: Part
	) {
		this._sideEffects = {
			...this._sideEffects,
			[name]: part,
		};

		type Merged = S & {
			[K in Name]: Part;
		};

		return this as unknown as SelectQuery<
			O,
			T,
			{
				[K in keyof Merged]: Merged[K];
			}
		>;
	}

	display(utils: DisplayUtils) {
		const thing = utils.var(this.tb[tbName]);
		const start = this._start && utils.var(this._start);
		const limit = this._limit && utils.var(this._limit);
		const sideEffects = `{${Object.entries(this._sideEffects).map(
			([name, part]) =>
				` ${JSON.stringify(name)}: (${part.display(utils)})`
		)} }`;

		let query = /* surql */ `SELECT VALUE { document: $this, sideEffects: ${sideEffects} } FROM $${thing}`;

		if (this._filter) {
			query += /* surql */ ` WHERE `;
			query += this._filter.display(utils);
		}

		if (start) query += /* surql */ ` START $${start}`;
		if (limit) query += /* surql */ ` LIMIT $${limit}`;

		return query;
	}

	readonly inferrable = true;
	get infer() {
		type Doc = inferTableTypes<T>;

		return undefined as unknown as {
			document: {
				[K in keyof Doc]: Doc[K];
			};
			sideEffects: {
				[K in keyof S]: S[K]["infer"];
			};
		}[];
	}

	validator() {
		return z.array(
			z.object({
				document: getTableZodType(this.tb),
				sideEffects: z.object(
					Object.fromEntries(
						Object.entries(this._sideEffects).map(([k, v]) => [
							k,
							v.validator(),
						])
					)
				),
			})
		);
	}

	cacher<O extends ORM<GenericTables>>(orm: O, input: this['infer']) {
		input.forEach(({ document, sideEffects }) => {
			const { tb, id } = document.id as RecordId<T[typeof tbName]>;
			orm.cache.set(tb, id, document);

			let effect: keyof S;
			for (effect in this._sideEffects) {
				this._sideEffects[effect].cacher(orm, sideEffects[effect]);
			}
		});
	};
}
