type OnFulfilled<T, TResult> = ((value: T) => TResult | PromiseLike<TResult>) | null | undefined;
type OnRejected<TResult> = ((reason: unknown) => TResult | PromiseLike<TResult>) | null | undefined;

/**
 * A form of `Promise` that defers the computation of a Promise until it is
 * subscribed to. This allows for the configuration of the eventual `Promise`
 * before it is dispatched.
 */
export abstract class DispatchedPromise<T> extends Promise<T> {
	#resolve!: (value: T | PromiseLike<T>) => void;
	#reject!: (reason?: unknown) => void;
	#dispatched = false;

	protected abstract dispatch(): Promise<T>;

	constructor() {
		let _resolve: undefined | ((value: T | PromiseLike<T>) => void);
		let _reject: undefined | ((reason?: unknown) => void);

		super((resolve, reject) => {
			_resolve = resolve;
			_reject = reject;
		});

		if (!_resolve || !_reject) {
			throw new Error("resolve and reject required");
		}

		this.#resolve = _resolve;
		this.#reject = _reject;
	}

	#ensureDispatched(): Promise<T> {
		if (!this.#dispatched) {
			this.#dispatched = true;
			this.dispatch().then(this.#resolve, this.#reject);
		}

		return this;
	}

	override then<TResult1 = T, TResult2 = never>(
		onfulfilled?: OnFulfilled<T, TResult1>,
		onrejected?: OnRejected<TResult2>,
	): Promise<TResult1 | TResult2> {
		this.#ensureDispatched();
		return super.then(onfulfilled, onrejected);
	}

	override catch<TResult = never>(onrejected?: OnRejected<TResult>): Promise<T | TResult> {
		this.#ensureDispatched();
		return super.catch(onrejected);
	}

	override finally(onfinally?: (() => void) | undefined | null): Promise<T> {
		this.#ensureDispatched();
		return super.finally(onfinally);
	}

	static get [Symbol.species](): PromiseConstructor {
		return Promise;
	}

	[Symbol.toStringTag] = "DispatchedPromise";
}