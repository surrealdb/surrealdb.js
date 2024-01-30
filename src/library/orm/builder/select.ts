import { RecordId, RecordIdValue } from "../../data/recordid.ts";
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
import { ZodType, z } from "npm:zod@^3.22.4";
import Surreal from "../../../index.ts";

type SideEffects = Record<string, QueryPart>;

export class SelectQuery<
	T extends Table<string, GenericFields>,
	I extends RecordIdValue | undefined,
	S extends SideEffects = SideEffects
> extends Query {
	readonly tb: T;
	readonly id?: I;
	private _filter?: Filter;
	private _start?: number;
	private _limit?: number;
	private _sideEffects: S = {} as S;
	surreal: Surreal;

	constructor(surreal: Surreal, tb: T, id?: I) {
		super();
		this.surreal = surreal;
		this.tb = tb;
		this.id = id;
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
			T,
			I,
			{
				[K in keyof Merged]: Merged[K];
			}
		>;
	}

	display(utils: DisplayUtils) {
		const thing = utils.var(
			this.id ? new RecordId(this.tb[tbName], this.id) : this.tb[tbName]
		);
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
		if (start) query += /* surql */ ` LIMIT $${limit}`;

		return query;
	}

	readonly inferrable = true;
	get infer() {
		type Table = inferTableTypes<T>;

		return undefined as unknown as {
			document: {
				[K in keyof Table]: Table[K];
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
		) as ZodType<this['infer']>;
	}
}
