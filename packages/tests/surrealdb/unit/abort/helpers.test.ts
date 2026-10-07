import { afterEach, describe, expect, test } from "bun:test";
import {
    abortableIterable,
    abortableSleep,
    abortReason,
    abortScope,
    addSignal,
    assertTimeout,
    raceAbort,
    throwIfAborted,
} from "../../../../sdk/src/internal/abort";

/** Counts the listeners a signal is holding, to tell whether something let go of it. */
function spyOnListeners(signal: AbortSignal) {
    const live = new Set<unknown>();
    const wrapped = new Map<unknown, EventListenerOrEventListenerObject>();
    const add = signal.addEventListener.bind(signal);
    const remove = signal.removeEventListener.bind(signal);

    signal.addEventListener = ((
        type: string,
        listener: EventListener,
        options?: AddEventListenerOptions | boolean,
    ) => {
        live.add(listener);

        // A listener which was registered to run once is gone as soon as it has
        if (typeof options === "object" && options.once) {
            const once: EventListener = (event) => {
                live.delete(listener);
                listener(event);
            };

            wrapped.set(listener, once);
            return add(type, once, options);
        }

        return add(type, listener, options);
    }) as typeof add;

    signal.removeEventListener = ((type: string, listener: EventListener, options?: unknown) => {
        live.delete(listener);
        return remove(type, wrapped.get(listener) ?? listener, options as never);
    }) as typeof remove;

    return {
        get held() {
            return live.size;
        },
    };
}

async function caught(promise: Promise<unknown>): Promise<unknown> {
    try {
        await promise;
    } catch (error) {
        return error;
    }

    throw new Error("Expected the promise to reject");
}

describe("abortReason and throwIfAborted", () => {
    test("the reason of a signal is passed through untouched", () => {
        const reason = new Error("because");
        const controller = new AbortController();
        controller.abort(reason);

        expect(abortReason(controller.signal)).toBe(reason);
        expect(() => throwIfAborted(controller.signal)).toThrow(reason);
    });

    test("aborting without a reason is an AbortError", () => {
        const controller = new AbortController();
        controller.abort();

        expect((abortReason(controller.signal) as Error).name).toBe("AbortError");
    });

    test("a runtime which records no reason is given an AbortError", () => {
        const signal = { aborted: true, reason: undefined } as AbortSignal;

        expect((abortReason(signal) as Error).name).toBe("AbortError");
    });

    test("nothing is thrown for a live signal or none at all", () => {
        expect(() => throwIfAborted(undefined)).not.toThrow();
        expect(() => throwIfAborted(new AbortController().signal)).not.toThrow();
    });
});

describe("addSignal", () => {
    test("appends, and ignores a missing signal", () => {
        const a = new AbortController().signal;
        const b = new AbortController().signal;

        expect(addSignal(undefined, undefined)).toBeUndefined();
        expect(addSignal(undefined, a)).toEqual([a]);
        expect(addSignal([a], b)).toEqual([a, b]);
        expect(addSignal([a], undefined)).toEqual([a]);
    });
});

describe("assertTimeout", () => {
    test("accepts zero and positive numbers", () => {
        expect(() => assertTimeout(0, "requestTimeout")).not.toThrow();
        expect(() => assertTimeout(1500, "requestTimeout")).not.toThrow();
    });

    test.each([-1, Number.NaN, Number.POSITIVE_INFINITY, "10", null])("rejects %p", (value) => {
        expect(() => assertTimeout(value, "requestTimeout")).toThrow(/requestTimeout/);
    });
});

// Run against the native implementation, and against the replacement used where there is none
describe.each([
    ["native", false],
    ["without AbortSignal.any and AbortSignal.timeout", true],
])("abortScope (%s)", (_, withoutNative) => {
    const any = AbortSignal.any;
    const timeout = AbortSignal.timeout;

    afterEach(() => {
        AbortSignal.any = any;
        AbortSignal.timeout = timeout;
    });

    const strip = () => {
        if (withoutNative) {
            AbortSignal.any = undefined as never;
            AbortSignal.timeout = undefined as never;
        }
    };

    test("no sources and no timeout leave nothing to abort", () => {
        strip();
        expect(abortScope([]).signal).toBeUndefined();
        expect(abortScope([undefined]).signal).toBeUndefined();
        expect(abortScope([], 0).signal).toBeUndefined();
    });

    test("a single source is used as it is", () => {
        strip();
        const controller = new AbortController();

        expect(abortScope([controller.signal]).signal).toBe(controller.signal);
    });

    test("aborts with the reason of whichever source aborts first", () => {
        strip();
        const first = new AbortController();
        const second = new AbortController();
        const { signal } = abortScope([first.signal, second.signal]);

        expect(signal?.aborted).toBe(false);

        const reason = new Error("second");
        second.abort(reason);

        expect(signal?.aborted).toBe(true);
        expect(signal?.reason).toBe(reason);

        first.abort(new Error("too late to matter"));
        expect(signal?.reason).toBe(reason);
    });

    test("a source which has aborted already aborts the result", () => {
        strip();
        const reason = new Error("already");
        const aborted = new AbortController();
        aborted.abort(reason);

        const { signal } = abortScope([new AbortController().signal, aborted.signal]);

        expect(signal?.aborted).toBe(true);
        expect(signal?.reason).toBe(reason);
    });

    test("a timeout aborts with a TimeoutError", async () => {
        strip();
        const { signal, dispose } = abortScope([], 10);

        expect(signal?.aborted).toBe(false);
        await Bun.sleep(40);

        expect(signal?.aborted).toBe(true);
        expect((signal?.reason as Error).name).toBe("TimeoutError");
        dispose();
    });

    test("a timeout and a source race, and the first wins", async () => {
        strip();
        const controller = new AbortController();
        const { signal } = abortScope([controller.signal], 1000);

        const reason = new Error("user");
        controller.abort(reason);

        expect(signal?.reason).toBe(reason);
    });

    test("a timeout which fires before the source reports as a TimeoutError", async () => {
        strip();
        const controller = new AbortController();
        const { signal } = abortScope([controller.signal], 10);

        await Bun.sleep(40);

        expect((signal?.reason as Error).name).toBe("TimeoutError");
    });

    test("disposing stops a timeout from firing", async () => {
        strip();
        const { signal, dispose } = abortScope([], 10);

        dispose();
        await Bun.sleep(40);

        // Natively the signal belongs to the runtime and cannot be taken back, so this is only
        // required of the replacement, which owns the timer.
        if (withoutNative) expect(signal?.aborted).toBe(false);
    });

    if (withoutNative) {
        test("disposing releases a signal which outlives the work", () => {
            strip();
            const longLived = new AbortController();
            const spy = spyOnListeners(longLived.signal);

            for (let i = 0; i < 50; i++) {
                const scope = abortScope([longLived.signal, new AbortController().signal]);
                scope.dispose();
            }

            expect(spy.held).toBe(0);
        });
    }
});

describe("raceAbort", () => {
    test("resolves with the promise when the signal does not abort", async () => {
        const controller = new AbortController();
        const spy = spyOnListeners(controller.signal);

        expect(await raceAbort(Promise.resolve(1), controller.signal)).toBe(1);
        expect(spy.held).toBe(0);
    });

    test("passes a rejection through, and lets go of the signal", async () => {
        const controller = new AbortController();
        const spy = spyOnListeners(controller.signal);
        const error = new Error("nope");

        expect(await caught(raceAbort(Promise.reject(error), controller.signal))).toBe(error);
        expect(spy.held).toBe(0);
    });

    test("rejects with the reason as soon as the signal aborts", async () => {
        const controller = new AbortController();
        const reason = new Error("stop");
        const racing = raceAbort(new Promise<never>(() => {}), controller.signal);

        controller.abort(reason);

        expect(await caught(racing)).toBe(reason);
    });

    test("rejects at once for a signal which has aborted already", async () => {
        const controller = new AbortController();
        const reason = new Error("stop");
        controller.abort(reason);

        expect(await caught(raceAbort(Promise.resolve(1), controller.signal))).toBe(reason);
    });

    test("hands a value arriving after the abort to discard, and ignores a late failure", async () => {
        const controller = new AbortController();
        const discarded: number[] = [];
        let late: (value: number) => void = () => {};

        const racing = raceAbort(
            new Promise<number>((resolve) => {
                late = resolve;
            }),
            controller.signal,
            (value) => discarded.push(value),
        );

        controller.abort(new Error("stop"));
        await caught(racing);
        late(7);
        await Bun.sleep(1);

        expect(discarded).toEqual([7]);

        // A failure after the fact must not surface as an unhandled rejection
        const failing = raceAbort(
            new Promise<never>((_, reject) => setTimeout(() => reject(new Error("late")), 5)),
            controller.signal,
        );
        await caught(failing);
        await Bun.sleep(20);
    });

    test("without a signal there is nothing to race", async () => {
        const promise = Promise.resolve(1);

        expect(raceAbort(promise, undefined)).toBe(promise);
    });
});

describe("abortableSleep", () => {
    test("sleeps", async () => {
        const started = performance.now();
        await abortableSleep(20);

        expect(performance.now() - started).toBeGreaterThanOrEqual(15);
    });

    test("ends early with the reason, and lets go of the signal", async () => {
        const controller = new AbortController();
        const spy = spyOnListeners(controller.signal);
        const reason = new Error("stop");
        const started = performance.now();
        const sleeping = abortableSleep(5000, controller.signal);

        setTimeout(() => controller.abort(reason), 10);

        expect(await caught(sleeping)).toBe(reason);
        expect(performance.now() - started).toBeLessThan(1000);
        expect(spy.held).toBe(0);
    });

    test("does not sleep for a signal which has aborted already", async () => {
        const controller = new AbortController();
        const reason = new Error("stop");
        controller.abort(reason);

        expect(await caught(abortableSleep(5000, controller.signal))).toBe(reason);
    });

    test("lets go of the signal after a full sleep", async () => {
        const controller = new AbortController();
        const spy = spyOnListeners(controller.signal);

        await abortableSleep(5, controller.signal);

        expect(spy.held).toBe(0);
    });
});

/** An iterable which yields what it is told to, and records how it was left. */
function scripted() {
    const log = { returned: 0, reads: 0, ended: 0 };
    let resolveNext: ((result: IteratorResult<number>) => void) | undefined;
    let rejectNext: ((error: unknown) => void) | undefined;

    const iterable: AsyncIterable<number> = {
        [Symbol.asyncIterator]() {
            return {
                next() {
                    log.reads++;
                    return new Promise<IteratorResult<number>>((resolve, reject) => {
                        resolveNext = resolve;
                        rejectNext = reject;
                    });
                },
                async return() {
                    log.returned++;
                    return { done: true as const, value: undefined };
                },
            };
        },
    };

    return {
        iterable,
        log,
        yields: (value: number) => resolveNext?.({ done: false, value }),
        finishes: () => resolveNext?.({ done: true, value: undefined }),
        fails: (error: unknown) => rejectNext?.(error),
    };
}

describe("abortableIterable", () => {
    test("without a signal the source is used as it is", () => {
        const source = scripted();

        expect(abortableIterable(source.iterable, undefined)).toBe(source.iterable);
    });

    test("yields what the source yields until it ends, then lets go of the signal", async () => {
        const controller = new AbortController();
        const spy = spyOnListeners(controller.signal);
        const source = scripted();
        let ended = 0;
        const iterator = abortableIterable(source.iterable, controller.signal, () => {
            ended++;
        })[Symbol.asyncIterator]();

        const first = iterator.next();
        source.yields(1);
        expect(await first).toEqual({ done: false, value: 1 });

        const second = iterator.next();
        source.finishes();
        expect((await second).done).toBe(true);

        expect(spy.held).toBe(0);
        expect(ended).toBe(1);
        expect((await iterator.next()).done).toBe(true);
    });

    test("a failure of the source passes through", async () => {
        const controller = new AbortController();
        const source = scripted();
        const iterator = abortableIterable(source.iterable, controller.signal)[
            Symbol.asyncIterator
        ]();
        const error = new Error("source failed");

        const reading = iterator.next();
        source.fails(error);

        expect(await caught(reading)).toBe(error);
    });

    test("a read in flight fails with the reason the moment the signal aborts", async () => {
        const controller = new AbortController();
        const source = scripted();
        const reason = new Error("stop");
        const iterator = abortableIterable(source.iterable, controller.signal)[
            Symbol.asyncIterator
        ]();

        const reading = iterator.next();
        controller.abort(reason);

        expect(await caught(reading)).toBe(reason);
        expect(source.log.returned).toBe(1);

        // The iteration is over, and a late value is not delivered
        source.yields(1);
        expect((await iterator.next()).done).toBe(true);
    });

    test("an abort while nobody is reading releases the source at once and is raised on the next read", async () => {
        const controller = new AbortController();
        const source = scripted();
        let ended = 0;
        const reason = new Error("stop");
        const iterator = abortableIterable(source.iterable, controller.signal, () => {
            ended++;
        })[Symbol.asyncIterator]();

        const first = iterator.next();
        source.yields(1);
        await first;

        controller.abort(reason);

        // Not waiting for a read: the source was let go of straight away
        expect(source.log.returned).toBe(1);
        expect(ended).toBe(1);

        expect(await caught(iterator.next())).toBe(reason);
        expect((await iterator.next()).done).toBe(true);
    });

    test("a signal which has aborted already fails the first read without reading", async () => {
        const controller = new AbortController();
        const reason = new Error("already");
        controller.abort(reason);
        const source = scripted();
        const iterator = abortableIterable(source.iterable, controller.signal)[
            Symbol.asyncIterator
        ]();

        expect(await caught(iterator.next())).toBe(reason);
        expect(source.log.reads).toBe(0);
    });

    test("leaving the loop early returns the source and lets go of the signal", async () => {
        const controller = new AbortController();
        const spy = spyOnListeners(controller.signal);
        const source = scripted();
        let ended = 0;

        const loop = (async () => {
            for await (const value of abortableIterable(source.iterable, controller.signal, () => {
                ended++;
            })) {
                return value;
            }
        })();

        await Bun.sleep(1);
        source.yields(9);

        expect(await loop).toBe(9);
        expect(source.log.returned).toBe(1);
        expect(spy.held).toBe(0);
        expect(ended).toBe(1);
    });

    test("a for await loop sees the reason as an exception", async () => {
        const controller = new AbortController();
        const source = scripted();
        const reason = new Error("stop");

        const loop = (async () => {
            for await (const _ of abortableIterable(source.iterable, controller.signal)) {
                // Never yields
            }
        })();

        await Bun.sleep(1);
        controller.abort(reason);

        expect(await caught(loop)).toBe(reason);
    });

    test("an abort with a read in flight on a generator parked on an await does not wait for it", async () => {
        // The state a stalled request leaves a generator in, and which defers its `return`
        const controller = new AbortController();
        const reason = new Error("stop");
        let parked = false;

        async function* stalled(): AsyncGenerator<number> {
            parked = true;
            await new Promise<never>(() => {});
            yield 1;
        }

        const started = performance.now();
        const reading = abortableIterable(stalled(), controller.signal)
            [Symbol.asyncIterator]()
            .next();

        await Bun.sleep(1);
        expect(parked).toBe(true);
        controller.abort(reason);

        expect(await caught(reading)).toBe(reason);
        expect(performance.now() - started).toBeLessThan(500);
    });
});
