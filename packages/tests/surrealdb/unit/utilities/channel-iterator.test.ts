import { describe, expect, test } from "bun:test";
import { ChannelIterator } from "surrealdb";

describe("ChannelIterator", () => {
    test("a burst of values delivers every one of them, in order", async () => {
        const channel = new ChannelIterator<number>();
        const first = channel.next();

        // The consumer is waiting on the first value only; the rest arrive before it can ask
        // again, which is how a stream of frames or a burst of notifications arrives.
        channel.submit(1);
        channel.submit(2);
        channel.submit(3);

        expect((await first).value).toBe(1);
        expect((await channel.next()).value).toBe(2);
        expect((await channel.next()).value).toBe(3);
    });

    test("values submitted before anyone asks are queued", async () => {
        const channel = new ChannelIterator<string>();

        channel.submit("a");
        channel.submit("b");

        const received: string[] = [];

        for await (const value of channel) {
            received.push(value);
            if (received.length === 2) channel.cancel();
        }

        expect(received).toEqual(["a", "b"]);
    });

    test("two readers waiting at once are both answered", async () => {
        const channel = new ChannelIterator<number>();
        const first = channel.next();
        const second = channel.next();

        channel.submit(1);
        channel.submit(2);

        expect((await first).value).toBe(1);
        expect((await second).value).toBe(2);
    });

    test("cancelling settles every reader still waiting", async () => {
        const channel = new ChannelIterator<number>();
        const first = channel.next();
        const second = channel.next();

        channel.cancel();

        expect(await first).toEqual({ value: undefined, done: true });
        expect(await second).toEqual({ value: undefined, done: true });
    });

    test("cancelling ends a pending read and drops what follows", async () => {
        const channel = new ChannelIterator<number>();
        const pending = channel.next();

        channel.cancel();
        channel.submit(1);

        expect(await pending).toEqual({ value: undefined, done: true });
        expect(await channel.next()).toEqual({ value: undefined, done: true });
    });

    test("leaving the iteration runs the cleanup and ends it", async () => {
        let cleaned = 0;
        const channel = new ChannelIterator<number>(() => {
            cleaned++;
        });

        channel.submit(1);
        channel.submit(2);

        for await (const value of channel) {
            expect(value).toBe(1);
            break;
        }

        expect(cleaned).toBe(1);
        expect(await channel.next()).toEqual({ value: undefined, done: true });
    });
});
