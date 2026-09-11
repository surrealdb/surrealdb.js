type Waiter<T> = (result: IteratorResult<T>) => void;

/**
 * The channel iterator is a utility class that allows you to submit values to an async iterator.
 */
export class ChannelIterator<T> implements AsyncIterable<T>, AsyncIterator<T> {
    #cancelled = false;
    #queue: T[] = [];
    #waiters: Waiter<T>[] = [];
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

        // Every reader is remembered, in the order it asked. A single slot would leave an earlier
        // reader's promise unsettled forever the moment a second one arrived.
        return new Promise<IteratorResult<T>>((resolve) => {
            this.#waiters.push(resolve);
        });
    }

    return(): Promise<IteratorResult<T>> {
        this.#end();

        return Promise.resolve({
            value: undefined,
            done: true,
        });
    }

    throw(error?: unknown): Promise<IteratorResult<T>> {
        // Cancel the iterator immediately - protocol errors should terminate the stream
        this.#end();

        // Propagate the error to the consumer
        return Promise.reject(error);
    }

    [Symbol.asyncIterator]() {
        return this;
    }

    submit(value: T): void {
        if (this.#cancelled) return;

        const waiter = this.#waiters.shift();

        if (waiter) {
            // Taken out of the queue before it is resolved. A second value submitted before the
            // consumer asks for the next one would otherwise resolve this same, already settled
            // promise, and every value but the first of a burst would be lost.
            waiter({ value, done: false });
            return;
        }

        this.#queue.push(value);
    }

    cancel(): void {
        this.#end();
    }

    /**
     * Ends the channel, settling every reader still waiting on it.
     */
    #end(): void {
        const waiters = this.#waiters;

        this.#cancelled = true;
        this.#waiters = [];
        this.#cleanup?.();

        for (const waiter of waiters) {
            waiter({ value: undefined, done: true });
        }
    }
}
