import { SurrealError } from "../errors";

/**
 * Helpers for cancelling work with an `AbortSignal`.
 *
 * Everything here is written for the lowest common denominator of the runtimes
 * the SDK supports. `AbortSignal.any` and `AbortSignal.timeout` are used when
 * they exist, and replaced by a small equivalent when they do not (React Native,
 * older browsers). `signal.reason` is likewise not assumed: runtimes which do
 * not record one are given an `AbortError` instead of `undefined`.
 *
 * A signal which aborts is reported with its own `reason`, untouched. That is
 * what lets an `AbortError` from `controller.abort()` and the `TimeoutError`
 * from `AbortSignal.timeout()` pass through the SDK unchanged, so a caller can
 * tell a user abort from a timeout the way they would with `fetch`.
 */

const noop = () => {};

/** The largest delay `setTimeout` accepts. Anything above fires immediately. */
const MAX_TIMER_DELAY = 2 ** 31 - 1;

/**
 * A set of signals folded into one, plus the means to let go of it.
 */
export interface AbortScope {
    /** Aborts when any source does. `undefined` when there is nothing to abort on. */
    readonly signal: AbortSignal | undefined;
    /** Stops watching the sources. Safe to call more than once. */
    dispose(): void;
}

/**
 * Options carried by every query builder to scope its cancellation.
 */
export interface AbortOptions {
    /** Signals which abort the query. All of them apply. */
    signals?: readonly AbortSignal[];
    /** Client-side limit in milliseconds for each request. `0` disables the connection default. */
    requestTimeout?: number;
}

/**
 * Create an `Error` with a given `name`, as a `DOMException` where the runtime has one.
 */
function createNamedError(message: string, name: string): Error {
    if (typeof DOMException === "function") {
        return new DOMException(message, name);
    }

    const error = new Error(message);
    error.name = name;
    return error;
}

/**
 * The reason a signal was aborted with.
 *
 * Runtimes which predate `AbortSignal.reason` leave it `undefined`, in which
 * case an `AbortError` stands in for it.
 */
export function abortReason(signal: AbortSignal): unknown {
    return signal.reason !== undefined
        ? signal.reason
        : createNamedError("This operation was aborted", "AbortError");
}

/**
 * Throw the reason of a signal if it has already aborted.
 */
export function throwIfAborted(signal: AbortSignal | undefined): void {
    if (signal?.aborted) {
        throw abortReason(signal);
    }
}

/**
 * Add a signal to those already carried by a query. A missing signal changes nothing.
 */
export function addSignal(
    signals: readonly AbortSignal[] | undefined,
    signal: AbortSignal | undefined,
): readonly AbortSignal[] | undefined {
    return signal ? [...(signals ?? []), signal] : signals;
}

/**
 * Reject a timeout which could not be honoured. `0` is allowed, and means none.
 */
export function assertTimeout(value: unknown, name: string): asserts value is number {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
        throw new SurrealError(`${name} must be a finite number of milliseconds, 0 or greater`);
    }
}

/**
 * Fold signals, and optionally a timeout, into a single signal.
 *
 * The result aborts with the reason of whichever source aborts first, so a
 * timeout surfaces as the `TimeoutError` of `AbortSignal.timeout()`.
 *
 * Where the runtime provides `AbortSignal.any`, the work is left to it and
 * `dispose` has nothing to do. Elsewhere the sources are watched by listeners,
 * which `dispose` removes, so that a signal outliving the work (an application
 * wide one, say) is not left holding on to every request it was ever combined
 * into.
 *
 * @param sources The signals to combine, ignoring missing ones
 * @param timeout A delay in milliseconds after which to abort, where above zero
 */
export function abortScope(
    sources: readonly (AbortSignal | undefined)[],
    timeout?: number,
): AbortScope {
    const signals = sources.filter((source): source is AbortSignal => source !== undefined);
    const cleanups: (() => void)[] = [];
    const dispose = () => {
        for (const cleanup of cleanups.splice(0)) cleanup();
    };

    if (timeout !== undefined && timeout > 0) {
        if (typeof AbortSignal.timeout === "function") {
            signals.push(AbortSignal.timeout(timeout));
        } else {
            const controller = new AbortController();
            const timer = setTimeout(
                () => {
                    controller.abort(createNamedError("The operation timed out.", "TimeoutError"));
                },
                Math.min(timeout, MAX_TIMER_DELAY),
            );

            // Do not keep a process alive for a timeout nobody is waiting on
            (timer as { unref?: () => void }).unref?.();
            cleanups.push(() => clearTimeout(timer));
            signals.push(controller.signal);
        }
    }

    if (signals.length === 0) {
        return { signal: undefined, dispose };
    }

    if (signals.length === 1) {
        return { signal: signals[0], dispose };
    }

    if (typeof AbortSignal.any === "function") {
        return { signal: AbortSignal.any(signals), dispose };
    }

    const combined = new AbortController();
    const aborted = signals.find((signal) => signal.aborted);

    if (aborted) {
        combined.abort(abortReason(aborted));
        return { signal: combined.signal, dispose };
    }

    for (const signal of signals) {
        const onAbort = () => {
            combined.abort(abortReason(signal));
            dispose();
        };

        signal.addEventListener("abort", onAbort, { once: true });
        cleanups.push(() => signal.removeEventListener("abort", onAbort));
    }

    return { signal: combined.signal, dispose };
}

/**
 * Wait for a promise, but no longer than the signal allows.
 *
 * When the signal aborts first, the returned promise rejects with its reason at
 * once, and whatever the original promise later does is ignored. A value it
 * resolves with after that is handed to `discard`, so that a resource which
 * nobody will use can still be released.
 *
 * @param promise The work to wait for
 * @param signal The signal which ends the wait
 * @param discard Releases a value which arrives after the wait has ended
 */
export function raceAbort<T>(
    promise: Promise<T>,
    signal: AbortSignal | undefined,
    discard?: (value: T) => void,
): Promise<T> {
    if (!signal) return promise;

    if (signal.aborted) {
        promise.then(discard, noop);
        return Promise.reject(abortReason(signal));
    }

    return new Promise<T>((resolve, reject) => {
        let settled = false;

        const onAbort = () => {
            settled = true;
            reject(abortReason(signal));
        };

        signal.addEventListener("abort", onAbort, { once: true });

        promise.then(
            (value) => {
                signal.removeEventListener("abort", onAbort);

                if (settled) {
                    discard?.(value);
                } else {
                    settled = true;
                    resolve(value);
                }
            },
            (error) => {
                signal.removeEventListener("abort", onAbort);

                if (!settled) {
                    settled = true;
                    reject(error);
                }
            },
        );
    });
}

/**
 * Sleep for a number of milliseconds, ending early with the reason of the
 * signal should it abort in the meantime.
 */
export function abortableSleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        if (signal?.aborted) {
            reject(abortReason(signal));
            return;
        }

        const onAbort = () => {
            clearTimeout(timer);
            reject(abortReason(signal as AbortSignal));
        };

        const timer = setTimeout(() => {
            signal?.removeEventListener("abort", onAbort);
            resolve();
        }, milliseconds);

        signal?.addEventListener("abort", onAbort, { once: true });
    });
}

/**
 * Let go of an iterator which will not be read again, without waiting for it.
 *
 * An async generator parked on an `await` only acts on `return()` once that
 * await settles, so the request is made and its outcome deliberately ignored.
 */
function release(iterator: AsyncIterator<unknown>): void {
    try {
        Promise.resolve(iterator.return?.()).catch(noop);
    } catch {
        // An iterator which cannot be released has nothing further to give up
    }
}

/**
 * Read an async iterable only for as long as a signal permits.
 *
 * When the signal aborts, a read in flight rejects with the signal's reason at
 * once instead of waiting for the source, and the source is released straight
 * away, so that whatever it holds (a request, a stream on the server) is let go
 * of even when nobody is currently reading. If nobody was, the reason is raised
 * on the next read. Either way the iteration is then over.
 *
 * Leaving the iteration early, with `break` or an exception, releases the
 * source as well and stops watching the signal.
 *
 * This is deliberately a hand written iterator rather than a generator: a
 * generator cannot be returned while it is parked on an await, which is exactly
 * the state a stalled request leaves it in.
 *
 * @param source The iterable to read
 * @param signal The signal which ends the iteration
 * @param onEnd Called once when the iteration ends, however it does
 */
export function abortableIterable<T>(
    source: AsyncIterable<T>,
    signal: AbortSignal | undefined,
    onEnd?: () => void,
): AsyncIterable<T> {
    if (!signal) return source;

    return {
        [Symbol.asyncIterator](): AsyncIterator<T> {
            const iterator = source[Symbol.asyncIterator]();

            // `aborted` holds a reason nobody has been told of yet
            let state: "open" | "aborted" | "closed" = "open";
            let failPending: ((reason: unknown) => void) | undefined;

            const end = () => {
                signal.removeEventListener("abort", onAbort);
                onEnd?.();
            };

            const onAbort = () => {
                if (state !== "open") return;

                end();
                release(iterator);

                if (failPending) {
                    state = "closed";
                    failPending(abortReason(signal));
                } else {
                    state = "aborted";
                }
            };

            if (signal.aborted) {
                state = "aborted";
                end();
                release(iterator);
            } else {
                signal.addEventListener("abort", onAbort, { once: true });
            }

            return {
                next(): Promise<IteratorResult<T>> {
                    if (state === "aborted") {
                        state = "closed";
                        return Promise.reject(abortReason(signal));
                    }

                    if (state === "closed") {
                        return Promise.resolve({ done: true, value: undefined });
                    }

                    return new Promise<IteratorResult<T>>((resolve, reject) => {
                        failPending = reject;

                        iterator.next().then(
                            (result) => {
                                failPending = undefined;

                                if (state === "open" && result.done) {
                                    state = "closed";
                                    end();
                                }

                                resolve(result);
                            },
                            (error) => {
                                failPending = undefined;

                                if (state === "open") {
                                    state = "closed";
                                    end();
                                }

                                reject(error);
                            },
                        );
                    });
                },

                return(value?: unknown): Promise<IteratorResult<T>> {
                    if (state === "open") end();
                    state = "closed";

                    return iterator.return
                        ? iterator.return(value)
                        : Promise.resolve({ done: true, value: value as undefined });
                },

                throw(error?: unknown): Promise<IteratorResult<T>> {
                    if (state === "open") end();
                    state = "closed";

                    return iterator.throw ? iterator.throw(error) : Promise.reject(error);
                },
            };
        },
    };
}
