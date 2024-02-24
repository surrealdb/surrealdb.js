import { QueryPart } from "./query.ts";
import { DisplayUtils } from "./display.ts";
import { Filter } from "./filters.ts";
import { ZodType, z } from "./types.ts";
import { GenericTables, ORM } from "./orm.ts";

type Last<T extends unknown[]> = T extends [...unknown[], infer R] ? R : never
type ExcludeFromTuple<T extends readonly unknown[], E> =
    T extends [infer F, ...infer R] ? [F] extends [E] ? ExcludeFromTuple<R, E> :
    [F, ...ExcludeFromTuple<R, E>] : []

export class Idiom<T extends QueryPart[]> extends QueryPart {
	readonly idiom: T;

	constructor(...idiom: T) {
		super();
		this.idiom = idiom;
	}

	display(utils: DisplayUtils) {
		return this.idiom
			.map((idiom) => {
				if (idiom instanceof Filter) {
					return `[WHERE ${idiom.display(utils)}]`;
				}

				return idiom.display(utils);
			})
			.join('');
	}

	readonly inferrable = true;
	get infer() {
		return undefined as unknown as Last<ExcludeFromTuple<{[K in keyof T]: T[K]['infer'] }, never>>
	}

	findPart() {
		return this.idiom.filter(p => p.inferrable).at(-1);
	}

	validator() {
		const part = this.findPart();
		if (!part) return z.never() as ZodType<this['infer']>;
		return part.validator() as ZodType<this['infer']>;
	}

	cacher<O extends ORM<GenericTables>>(orm: O, input: this['infer']) {
		const part = this.findPart();
		if (part) {
			part.cacher(orm, input);
		}
	}
}

export function idiom<T extends QueryPart[]>(...idiom: T) {
	return new Idiom(...idiom);
}
