interface Waiter<T> {
    resolve(result: IteratorResult<T>): void;
    reject(error: unknown): void;
}

/**
 * The channel iterator is a utility class that allows you to submit values to an async iterator.
 */
export class ChannelIterator<T> implements AsyncIterable<T>, AsyncIterator<T> {
    #closed = false;
    #failure?: { error: unknown };
    #queue: T[] = [];
    #waiters: Waiter<T>[] = [];
    #cleanup?: () => void;

    constructor(cleanup?: () => void) {
        this.#cleanup = cleanup;
    }

    next(): Promise<IteratorResult<T>> {
        if (this.#queue.length > 0) {
            return Promise.resolve({
                value: this.#queue.shift() as T,
                done: false,
            });
        }

        if (this.#failure) {
            const { error } = this.#failure;
            this.#failure = undefined;
            return Promise.reject(error);
        }

        if (this.#closed) {
            return Promise.resolve({ value: undefined, done: true });
        }

        // Every reader is remembered, in the order it asked. A single slot would leave an earlier
        // reader's promise unsettled forever the moment a second one arrived.
        return new Promise<IteratorResult<T>>((resolve, reject) => {
            this.#waiters.push({ resolve, reject });
        });
    }

    return(): Promise<IteratorResult<T>> {
        this.cancel();

        return Promise.resolve({
            value: undefined,
            done: true,
        });
    }

    throw(error?: unknown): Promise<IteratorResult<T>> {
        // Cancel the iterator immediately - protocol errors should terminate the stream
        this.cancel();

        // Propagate the error to the consumer
        return Promise.reject(error);
    }

    [Symbol.asyncIterator]() {
        return this;
    }

    submit(value: T): void {
        if (this.#closed) return;

        const waiter = this.#waiters.shift();

        if (waiter) {
            // Taken out of the queue before it is resolved. A second value submitted before the
            // consumer asks for the next one would otherwise resolve this same, already settled
            // promise, and every value but the first of a burst would be lost.
            waiter.resolve({ value, done: false });
            return;
        }

        this.#queue.push(value);
    }

    cancel(): void {
        this.#queue = [];
        this.#failure = undefined;
        this.finish();
    }

    /**
     * End the channel after its queued values have been read.
     */
    finish(): void {
        if (this.#closed) return;

        this.#closed = true;
        const waiters = this.#waiters;
        this.#waiters = [];

        for (const waiter of waiters) {
            waiter.resolve({ value: undefined, done: true });
        }

        const cleanup = this.#cleanup;
        this.#cleanup = undefined;
        cleanup?.();
    }

    /**
     * Discard queued values and reject one read with the terminal error.
     */
    fail(error: unknown): void {
        if (this.#closed) return;

        this.#queue = [];
        const reader = this.#waiters.shift();

        if (reader) {
            reader.reject(error);
        } else {
            this.#failure = { error };
        }

        this.finish();
    }
}
