type OnFulfilled<T, TResult> =
	| ((value: T) => TResult | PromiseLike<TResult>)
	| null
	| undefined;

type OnRejected<TResult> =
	| ((reason: unknown) => TResult | PromiseLike<TResult>)
	| null
	| undefined;

type OnFinally = (() => void) | null | undefined;

/**
 * A form of `Promise` that allows you to configure the eventual execution
 * of a task by mutating state.
 */
export abstract class Future<T, S extends Record<string, unknown>>
	implements PromiseLike<T>, Promise<T>
{
	#executor: (state: S) => Promise<T>;

	protected _state: S = {} as S;

	constructor(execute: (state: S) => Promise<T>) {
		this.#executor = execute;
	}

	then<TResult1 = T, TResult2 = never>(
		onfulfilled?: OnFulfilled<T, TResult1>,
		onrejected?: OnRejected<TResult2>,
	): Promise<TResult1 | TResult2> {
		return this.#executor(this._state).then(onfulfilled, onrejected);
	}

	catch<TResult = never>(
		onrejected?: OnRejected<TResult>,
	): Promise<T | TResult> {
		return this.#executor(this._state).catch(onrejected);
	}

	finally(onfinally?: OnFinally): Promise<T> {
		return this.#executor(this._state).finally(onfinally);
	}

	[Symbol.toStringTag] = "Future";
}
