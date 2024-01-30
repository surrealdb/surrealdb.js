import { ZodArray } from "npm:zod@^3.22.4";
import { DisplayUtils } from "./display.ts";
import { QueryPart } from "./query.ts";
import { Field } from "./schema.ts";
import { ZodTuple, ZodType, z } from "./types.ts";

export abstract class Filter extends QueryPart {
	readonly inferrable = false;
	get infer(): never {
		throw new Error("Filter has no type to be inferred");
	}

	validator() {
		return z.never();
	}
}
export const JoiningKind = z.union([z.literal("OR"), z.literal("AND")]);
export const PrefixKind = z.literal("!");
export const ComparingOperator = z.union([
	z.literal("??"),
	z.literal("?:"),
	z.literal("="),
	z.literal("!="),
	z.literal("=="),
	z.literal("?="),
	z.literal("*="),
	z.literal("~"),
	z.literal("!~"),
	z.literal("?~"),
	z.literal("*~"),
	z.literal("<"),
	z.literal("<="),
	z.literal(">"),
	z.literal(">="),
	z.literal("IN"),
	z.literal("NOT IN"),
	z.literal("CONTAINS"),
	z.literal("CONTAINSNOT"),
	z.literal("CONTAINSALL"),
	z.literal("CONTAINSANY"),
	z.literal("CONTAINSNONE"),
	z.literal("INSIDE"),
	z.literal("NOTINSIDE"),
	z.literal("ALLINSIDE"),
	z.literal("ANYINSIDE"),
	z.literal("NONEINSIDE"),
	z.literal("OUTSIDE"),
	z.literal("INTERSECTS"),
]);

export class JoiningFilter extends Filter {
	readonly kind: z.infer<typeof JoiningKind>;
	readonly filters: QueryPart[];

	constructor(
		kind: z.infer<typeof JoiningKind>,
		...filters: (QueryPart | unknown)[]
	) {
		super();
		this.kind = JoiningKind.parse(kind);
		this.filters = filters.filter((f): f is QueryPart => f instanceof QueryPart);
	}

	display(utils: DisplayUtils) {
		return '(' + this.filters.map((f) => f.display(utils)).join(` ${this.kind} `) + ')';
	}
}

export class PrefixedFilter extends Filter {
	readonly kind: z.infer<typeof PrefixKind>;
	readonly filter: QueryPart;

	constructor(
		kind: z.infer<typeof PrefixKind>,
		filter: QueryPart,
	) {
		super();
		this.kind = PrefixKind.parse(kind);
		this.filter = filter;
	}

	display(utils: DisplayUtils) {
		return `${this.kind} (${this.filter.display(utils)})`;
	}
}

export class ComparingFilter<T extends Field<string, ZodType>> extends Filter {
	readonly field: T;
	readonly operator: z.infer<typeof ComparingOperator>;
	readonly comp: z.infer<T["type"]> | QueryPart;

	constructor(
		field: T,
		operator: z.infer<typeof ComparingOperator>,
		comp: z.infer<T["type"]> | QueryPart
	) {
		super();
		this.field = field;
		this.operator = ComparingOperator.parse(operator);
		this.comp = comp;
	}

	display(utils: DisplayUtils) {
		if (this.comp instanceof QueryPart) {
			return `(\`${this.field.name}\` ${this.operator} ${this.comp.display(utils)})`;
		} else {
			const varName = utils.var(this.comp);
			return `(\`${this.field.name}\` ${this.operator} $${varName})`;
		}
	}
}

export function or(...filters: (QueryPart | unknown)[]) {
	return new JoiningFilter("OR", ...filters);
}

export function and(...filters: (QueryPart | unknown)[]) {
	return new JoiningFilter("AND", ...filters);
}

export function not(filter: QueryPart) {
	return new PrefixedFilter("!", filter);
}

export function op<T extends Field<string, ZodType>>(
	field: T,
	operator: z.infer<typeof ComparingOperator>,
	comp: z.infer<T["type"]> | QueryPart
) {
	return new ComparingFilter(field, operator, comp);
}

function opFactory(op: z.infer<typeof ComparingOperator>) {
	return function<T extends Field<string, ZodType>>(
		field: T,
		comp: z.infer<T["type"]> | QueryPart
	) {
		return new ComparingFilter(field, op, comp);
	}
}

// BASIC COMPARISON

export const eq           = opFactory('=');
export const ne           = opFactory('!=');
export const ex           = opFactory('==');

export function anyEq<T extends Field<string, ZodArray<ZodType> | ZodTuple>>(
	field: T,
	comp: z.infer<T["type"]>[number][] | QueryPart
) {
	return new ComparingFilter(field, '?=', comp);
}

export function allEq<T extends Field<string, ZodArray<ZodType> | ZodTuple>>(
	field: T,
	comp: z.infer<T["type"]>[number][] | QueryPart
) {
	return new ComparingFilter(field, '*=', comp);
}

// FUZZY MATCHING

export const fy           = opFactory('~');
export const notFy        = opFactory('!~');

export function anyFy<T extends Field<string, ZodArray<ZodType> | ZodTuple>>(
	field: T,
	comp: z.infer<T["type"]>[number][] | QueryPart
) {
	return new ComparingFilter(field, '?~', comp);
}

export function allFy<T extends Field<string, ZodArray<ZodType> | ZodTuple>>(
	field: T,
	comp: z.infer<T["type"]>[number][] | QueryPart
) {
	return new ComparingFilter(field, '*~', comp);
}

// GREATER/LESS

export const gt           = opFactory('>');
export const gte          = opFactory('>=');
export const lt           = opFactory('<');
export const lte          = opFactory('<=');

// INSIDE

export function inside<T extends Field<string, ZodType>>(
	field: T,
	comp: z.infer<T["type"]>[] | QueryPart
) {
	return new ComparingFilter(field, 'IN', comp);
}

export function notInside<T extends Field<string, ZodType>>(
	field: T,
	comp: z.infer<T["type"]>[] | QueryPart
) {
	return new ComparingFilter(field, 'NOT IN', comp);
}

export function allInside<T extends Field<string, ZodArray<ZodType> | ZodTuple>>(
	field: T,
	comp: z.infer<T["type"]>[number][] | QueryPart
) {
	return new ComparingFilter(field, 'ALLINSIDE', comp);
}

export function anyInside<T extends Field<string, ZodArray<ZodType> | ZodTuple>>(
	field: T,
	comp: z.infer<T["type"]>[number][] | QueryPart
) {
	return new ComparingFilter(field, 'ANYINSIDE', comp);
}

export function noneInside<T extends Field<string, ZodArray<ZodType> | ZodTuple>>(
	field: T,
	comp: z.infer<T["type"]>[number][] | QueryPart
) {
	return new ComparingFilter(field, 'NONEINSIDE', comp);
}

// CONTAINS

export function contains<T extends Field<string, ZodArray<ZodType> | ZodTuple>>(
	field: T,
	comp: z.infer<T["type"]>[number] | QueryPart
) {
	return new ComparingFilter(field, 'CONTAINS', comp);
}

export function containsNot<T extends Field<string, ZodArray<ZodType> | ZodTuple>>(
	field: T,
	comp: z.infer<T["type"]>[number] | QueryPart
) {
	return new ComparingFilter(field, 'CONTAINSNOT', comp);
}

export function containsAll<T extends Field<string, ZodArray<ZodType> | ZodTuple>>(
	field: T,
	comp: z.infer<T["type"]>[number][] | QueryPart
) {
	return new ComparingFilter(field, 'CONTAINSALL', comp);
}

export function containsAny<T extends Field<string, ZodArray<ZodType> | ZodTuple>>(
	field: T,
	comp: z.infer<T["type"]>[number][] | QueryPart
) {
	return new ComparingFilter(field, 'CONTAINSANY', comp);
}

export function containsNone<T extends Field<string, ZodArray<ZodType> | ZodTuple>>(
	field: T,
	comp: z.infer<T["type"]>[number][] | QueryPart
) {
	return new ComparingFilter(field, 'CONTAINSNONE', comp);
}

// OTHERS

export const outside      = opFactory('OUTSIDE');
export const intersects   = opFactory('INTERSECTS');

// CUSTOM

