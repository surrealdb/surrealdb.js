type OnFulfilled<T, TResult> = ((value: T) => TResult | PromiseLike<TResult>) | null | undefined;
type OnRejected<TResult> = ((reason: unknown) => TResult | PromiseLike<TResult>) | null | undefined;

/** Satisfies the `Promise` constructor without settling the inherited state. */
const NOOP = () => {};

export abstract class DispatchedPromise<T> extends Promise<T> {
    /**
     * The promise which actually carries this one's state.
     *
     * `then` / `catch` / `finally` all delegate here rather than to `super`, and the
     * inherited promise state (settled by the `NOOP` executor above, i.e. never) is
     * deliberately unused. That indirection is what makes this class portable:
     *
     * React Native replaces the global `Promise` with a JavaScript polyfill (the `promise`
     * package) whose `then` sends any subclass down a `safeThen` path that does
     * `new self.constructor(executor)`. This constructor takes no arguments and cannot
     * honour that executor - and neither can subclasses such as `Query`, whose
     * constructors have their own signatures - so the promise returned to the caller would
     * never settle, hanging every lazily dispatched API on React Native. `Symbol.species`
     * does not help, because the polyfill reads `self.constructor` rather than species.
     *
     * Delegating to a plain `Promise` sidesteps the whole problem: its `constructor` *is*
     * `Promise`, so the fast path is always taken, on every runtime.
     */
    readonly #inner: Promise<T>;
    #resolve!: (value: T | PromiseLike<T>) => void;
    #reject!: (reason?: unknown) => void;
    #dispatched = false;

    protected abstract dispatch(): Promise<T>;

    constructor() {
        super(NOOP);

        this.#inner = new Promise<T>((resolve, reject) => {
            this.#resolve = resolve;
            this.#reject = reject;
        });
    }

    #ensureDispatched(): Promise<T> {
        if (!this.#dispatched) {
            this.#dispatched = true;
            this.dispatch().then(this.#resolve, this.#reject);
        }

        return this.#inner;
    }

    override then<TResult1 = T, TResult2 = never>(
        onfulfilled?: OnFulfilled<T, TResult1>,
        onrejected?: OnRejected<TResult2>,
    ): Promise<TResult1 | TResult2> {
        return this.#ensureDispatched().then(onfulfilled, onrejected);
    }

    override catch<TResult = never>(onrejected?: OnRejected<TResult>): Promise<T | TResult> {
        return this.#ensureDispatched().catch(onrejected);
    }

    override finally(onfinally?: (() => void) | undefined | null): Promise<T> {
        return this.#ensureDispatched().finally(onfinally);
    }

    static override get [Symbol.species](): PromiseConstructor {
        return Promise;
    }

    override get [Symbol.toStringTag]() {
        return "DispatchedPromise";
    }
}
