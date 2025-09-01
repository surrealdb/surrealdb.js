export class ChannelIterator<T> implements AsyncIterable<T>, AsyncIterator<T> {
    #cancelled = false;
    #queue: T[] = [];
    #waiter?: (r: IteratorResult<T>) => void;
    #cleanup?: () => void;

    constructor(cleanup?: () => void) {
        this.#cleanup = cleanup;
    }

    next(): Promise<IteratorResult<T>> {
        if (this.#cancelled) {
            return Promise.resolve({
                value: undefined,
                done: true,
            });
        }

        if (this.#queue.length > 0) {
            return Promise.resolve({
                value: this.#queue.shift() as T,
                done: false,
            });
        }

        return new Promise<IteratorResult<T>>((resolve) => {
            this.#waiter = resolve;
        });
    }

    return(): Promise<IteratorResult<T>> {
        this.#cancelled = true;
        this.#cleanup?.();
        this.#waiter?.({
            value: undefined,
            done: true,
        });

        return Promise.resolve({
            value: undefined,
            done: true,
        });
    }

    [Symbol.asyncIterator]() {
        return this;
    }

    submit(value: T): void {
        if (this.#cancelled) this.return;

        if (this.#waiter) {
            this.#waiter({ value, done: false });
            return;
        }

        this.#queue.push(value);
    }

    cancel(): void {
        this.#cancelled = true;
        this.#cleanup?.();
        this.#waiter?.({ value: undefined, done: true });
    }
}
