import { Surreal } from "../../../mod.ts";
import { DisplayUtils, createDisplayUtils } from "./display.ts";
import { ZodType } from "./types.ts";

export abstract class QueryPart {
	abstract display(utils: DisplayUtils): string;
	abstract validator(): ZodType;
	abstract infer: unknown
	abstract readonly inferrable: boolean;

	clone(): this {
		return Object.assign(Object.create(Object.getPrototypeOf(this)), this);
	}
};

export abstract class Query extends QueryPart implements Promise<unknown> {
	[Symbol.toStringTag] = 'Query';

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

	abstract surreal: Surreal;
	async execute() {
		const { variables, utils } = createDisplayUtils();
		const query = this.display(utils);
		const [result] = await this.surreal.query<[this['infer']]>(query, variables);
		return this.validator().parse(result);
	}
};
