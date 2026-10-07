import { describe, expect, test } from "bun:test";
import { relayIterable } from "../../../../sdk/src/internal/relay";

/** A source which counts what is done to it, and can be held on a read until it is let go. */
function source<T>(items: T[], options: { park?: boolean } = {}) {
    const state = { opened: 0, returned: 0, reads: 0 };
    let release: (() => void) | undefined;
    const parked = new Promise<void>((resolve) => {
        release = resolve;
    });

    const iterable: AsyncIterable<T> = {
        [Symbol.asyncIterator]() {
            state.opened++;

            let next = 0;

            return {
                async next(): Promise<IteratorResult<T>> {
                    state.reads++;

                    if (options.park) await parked;

                    return next < items.length
                        ? { value: items[next++] as T, done: false }
                        : { value: undefined, done: true };
                },
                async return(): Promise<IteratorResult<T>> {
                    state.returned++;
                    release?.();

                    return { value: undefined, done: true };
                },
            };
        },
    };

    return { iterable, state };
}

describe("relayIterable", () => {
    test("opens its source on the first read, not before", async () => {
        const { iterable, state } = source([1]);
        let opened = 0;

        const relay = relayIterable(() => {
            opened++;
            return iterable;
        });

        const iterator = relay[Symbol.asyncIterator]();

        expect(opened).toBe(0);

        await iterator.next();

        expect(opened).toBe(1);
        expect(state.opened).toBe(1);
    });

    test("relays every value, and tells the tap how it ended, once", async () => {
        const { iterable } = source(["a", "b"]);
        const seen: unknown[] = [];
        const ended: unknown[] = [];

        const relay = relayIterable(() => iterable, {
            value: (value) => seen.push(value),
            end: (error) => ended.push(error),
        });

        const read: string[] = [];

        for await (const value of relay) read.push(value);

        expect(read).toEqual(["a", "b"]);
        expect(seen).toEqual(["a", "b"]);
        expect(ended).toEqual([undefined]);
    });

    test("tells the tap of the error which ended it, and passes it on", async () => {
        const failing: AsyncIterable<number> = {
            [Symbol.asyncIterator]: () => ({
                async next(): Promise<IteratorResult<number>> {
                    throw new Error("the connection went away");
                },
            }),
        };
        const ended: unknown[] = [];

        const relay = relayIterable(() => failing, { end: (error) => ended.push(error) });

        await expect(relay[Symbol.asyncIterator]().next()).rejects.toThrow("went away");
        expect((ended[0] as Error).message).toBe("the connection went away");
        expect(ended).toHaveLength(1);
    });

    test("a reader which leaves is not an ending", async () => {
        const { iterable, state } = source([1, 2, 3]);
        const ended: unknown[] = [];

        const relay = relayIterable(() => iterable, { end: (error) => ended.push(error) });

        for await (const _ of relay) break;

        expect(state.returned).toBe(1);
        expect(ended).toEqual([]);
    });

    test("leaving reaches a source which is parked on a read at once", async () => {
        // The source has nothing to send, as a stream waiting on the server has not.
        const { iterable, state } = source([1], { park: true });
        const iterator = relayIterable(() => iterable)[Symbol.asyncIterator]();

        const read = iterator.next();

        await Bun.sleep(10);

        const outcome = await Promise.race([
            Promise.all([read, iterator.return?.()]).then(() => "let go"),
            Bun.sleep(2_000).then(() => "still waiting"),
        ]);

        // A generator in its place would have deferred the `return()` until the read finished.
        expect(outcome).toBe("let go");
        expect(state.returned).toBe(1);
    });

    test("leaving before it was read opens nothing", async () => {
        const { iterable, state } = source([1]);
        const iterator = relayIterable(() => iterable)[Symbol.asyncIterator]();

        await iterator.return?.();

        expect(state.opened).toBe(0);
        expect(await iterator.next()).toEqual({ value: undefined, done: true });
    });

    test("leaving while it is still opening lets go of what is opened", async () => {
        const { iterable, state } = source([1]);
        let opened!: () => void;
        const gate = new Promise<void>((resolve) => {
            opened = resolve;
        });

        const iterator = relayIterable(async () => {
            await gate;
            return iterable;
        })[Symbol.asyncIterator]();

        const read = iterator.next();
        const left = iterator.return?.();

        opened();

        await left;

        expect(await read).toEqual({ value: undefined, done: true });
        expect(state.returned).toBe(1);
    });

    test("an error opening the source is the error of the first read, and told to the tap", async () => {
        const ended: unknown[] = [];

        const iterator = relayIterable<number>(
            async () => {
                throw new Error("could not prepare");
            },
            { end: (error) => ended.push(error) },
        )[Symbol.asyncIterator]();

        await expect(iterator.next()).rejects.toThrow("could not prepare");
        expect(ended).toHaveLength(1);
    });
});
