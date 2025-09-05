/**
 * The channel iterator is a utility class that allows you to submit values to an async iterator.
 */
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

    throw(error?: unknown): Promise<IteratorResult<T>> {
        // Cancel the iterator immediately - protocol errors should terminate the stream
        this.#cancelled = true;
        this.#cleanup?.();

        // If there's a waiter, resolve it with the error
        if (this.#waiter) {
            this.#waiter({ value: undefined, done: true });
            this.#waiter = undefined;
        }

        // Propagate the error to the consumer
        return Promise.reject(error);
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
