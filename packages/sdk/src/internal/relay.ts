/**
 * Observers of what a relayed iterable yields. `end` is called once, when the source runs out
 * (no argument) or throws (its error). It is not called when the reader leaves early.
 */
export interface RelayTap<T> {
    value?(value: T): void;
    end?(error?: unknown): void;
}

/**
 * An async iterable which stands in front of another, opened on first read, without ever
 * being a generator.
 *
 * A generator cannot be returned while it is parked on an await, so one placed in front of a
 * stream which is waiting on the server would hold back the `return()` which is meant to reach
 * it (and send the cancel) until the stream ended by itself. This forwards `return()` at once.
 *
 * @param open Opens the source, once, on the first read
 * @param tap Observes what is yielded and how the source ends
 */
export function relayIterable<T>(
    open: () => AsyncIterable<T> | Promise<AsyncIterable<T>>,
    tap: RelayTap<T> = {},
): AsyncIterable<T> {
    return {
        [Symbol.asyncIterator](): AsyncIterator<T> {
            let iterator: AsyncIterator<T> | undefined;
            let starting: Promise<AsyncIterator<T>> | undefined;
            let closed = false;

            const start = (): Promise<AsyncIterator<T>> => {
                starting ??= (async () => {
                    const source = await open();
                    const opened = source[Symbol.asyncIterator]();

                    iterator = opened;

                    return opened;
                })();

                return starting;
            };

            return {
                async next(): Promise<IteratorResult<T>> {
                    if (closed) return { done: true, value: undefined };

                    try {
                        const source = await start();

                        if (closed) return { done: true, value: undefined };

                        const result = await source.next();

                        if (closed) return { done: true, value: undefined };

                        if (result.done) {
                            closed = true;
                            tap.end?.();
                        } else {
                            tap.value?.(result.value);
                        }

                        return result;
                    } catch (error) {
                        if (!closed) {
                            closed = true;
                            tap.end?.(error);
                        }

                        throw error;
                    }
                },

                async return(value?: unknown): Promise<IteratorResult<T>> {
                    if (!closed) {
                        closed = true;

                        // Opening may be in flight, in which case what it opens is let go of here
                        const source = iterator ?? (await starting?.catch(() => undefined));

                        await source?.return?.();
                    }

                    return { done: true, value: value as undefined };
                },
            };
        },
    };
}
