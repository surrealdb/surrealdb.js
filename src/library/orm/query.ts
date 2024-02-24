import { DisplayUtils, createDisplayUtils } from "./display.ts";
import { ZodType } from "./types.ts";
import { ORMAwaitable, ORM, GenericTables } from "./orm.ts";

export abstract class QueryPart {
	abstract display(utils: DisplayUtils): string;
	abstract cacher<O extends ORM<GenericTables>>(orm: O, value: this['infer']): void;
	abstract validator(): ZodType;
	abstract infer: unknown;
	abstract readonly inferrable: boolean;

	clone(): this {
		return Object.assign(Object.create(Object.getPrototypeOf(this)), this);
	}
};

export abstract class Query<O extends ORM<GenericTables>> extends QueryPart implements ORMAwaitable<O> {
	[Symbol.toStringTag] = 'Query';

	abstract orm: O;

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

	async execute() {
		const utils = createDisplayUtils();
		const query = this.display(utils);
		const [result] = await this.orm.surreal.query<[this['infer']]>(query, utils.variables);
		const data = this.validator().parse(result);
		return data as this['infer'];
	}
};
