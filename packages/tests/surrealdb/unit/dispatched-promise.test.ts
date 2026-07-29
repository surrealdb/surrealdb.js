import { describe, expect, test } from "bun:test";
import { DispatchedPromise } from "../../../sdk/src/internal/dispatched-promise";

class Dispatched<T> extends DispatchedPromise<T> {
    dispatchCount = 0;

    constructor(
        private readonly value: T,
        private readonly shouldReject = false,
    ) {
        super();
    }

    protected override async dispatch(): Promise<T> {
        this.dispatchCount += 1;

        if (this.shouldReject) {
            throw new Error("dispatch rejected");
        }

        return this.value;
    }
}

// Every instance below is awaited before its test ends. An un-awaited instance is left
// forever pending, which the test runner may then wait on.
describe("DispatchedPromise", () => {
    test("does not dispatch until awaited", async () => {
        const promise = new Dispatched("value");

        expect(promise.dispatchCount).toBe(0);

        await promise;

        expect(promise.dispatchCount).toBe(1);
    });

    test("dispatches only once across multiple consumers", async () => {
        const promise = new Dispatched("value");

        const [a, b, c] = await Promise.all([promise, promise.then((v) => v), promise]);

        expect([a, b, c]).toEqual(["value", "value", "value"]);
        expect(promise.dispatchCount).toBe(1);
    });

    test("resolves through await, then, and finally", async () => {
        expect(await new Dispatched("via await")).toBe("via await");
        expect(await new Dispatched("via then").then((v) => `${v}!`)).toBe("via then!");

        let ranFinally = false;
        await new Dispatched("via finally").finally(() => {
            ranFinally = true;
        });
        expect(ranFinally).toBe(true);
    });

    test("propagates rejections through await and catch", async () => {
        let message: string | undefined;

        try {
            await new Dispatched("unused", true);
        } catch (error) {
            message = (error as Error).message;
        }

        expect(message).toBe("dispatch rejected");
        expect(await new Dispatched("unused", true).catch((e) => (e as Error).message)).toBe(
            "dispatch rejected",
        );
    });

    test("is a Promise instance and reports its tag", async () => {
        const promise = new Dispatched("value");

        expect(promise).toBeInstanceOf(Promise);
        expect(Object.prototype.toString.call(promise)).toBe("[object DispatchedPromise]");

        await promise;
    });

    /**
     * React Native replaces the global `Promise` with a JavaScript polyfill (the `promise`
     * package) whose `then` routes any *subclass* instance through a `safeThen` helper that
     * does `new self.constructor(executor)`. `DispatchedPromise` takes no constructor
     * arguments, and its subclasses (`Query`, `ManagedLivePromise`, ...) have their own
     * signatures, so none of them can honour that executor - the promise handed back to the
     * caller never settles, which hangs every lazily dispatched API on React Native.
     *
     * The defence is that `then` / `catch` / `finally` return a plain `Promise` rather than
     * anything derived from `this`, so a polyfill only ever sees `constructor === Promise`
     * and always takes its fast path. Keep these assertions: returning a subclass instance
     * here silently breaks React Native while every other runtime stays green.
     */
    test("then, catch and finally return plain promises, not subclass instances", async () => {
        const chained = new Dispatched("value").then((v) => v);
        const caught = new Dispatched("value").catch(() => undefined);
        const finalized = new Dispatched("value").finally(() => undefined);

        for (const result of [chained, caught, finalized]) {
            expect(result.constructor).toBe(Promise);
            expect(result).not.toBeInstanceOf(DispatchedPromise);
        }

        await Promise.all([chained, caught, finalized]);
    });
});
