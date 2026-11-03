import { describe, expect, test } from "bun:test";
import { backoffDelay } from "../../../sdk/src/internal/backoff";
import { DEFAULT_RECONNECT_OPTIONS, ReconnectContext } from "../../../sdk/src/internal/reconnect";

/**
 * The defaults are pinned here because every other SDK is written to match them, and nothing
 * else in the suite reads them: they drifted apart unnoticed once already.
 */
describe("the reconnect defaults", () => {
    test("are the ones the other SDKs are written against", () => {
        expect(DEFAULT_RECONNECT_OPTIONS).toEqual({
            enabled: true,
            attempts: -1,
            retryDelay: 1000,
            retryDelayMax: 20000,
            retryDelayMultiplier: 2,
            retryDelayJitter: 0.1,
        });
    });

    test("double from two seconds and stop growing at twenty", () => {
        // delay(n) = retryDelay * multiplier**n * (1 ± jitter), capped, with n counting from 1
        const expected = [2000, 4000, 8000, 16000, 20000, 20000, 20000];

        for (const [index, base] of expected.entries()) {
            const delay = backoffDelay(DEFAULT_RECONNECT_OPTIONS, index + 1);

            expect(delay).toBeLessThanOrEqual(DEFAULT_RECONNECT_OPTIONS.retryDelayMax);
            expect(delay).toBeGreaterThanOrEqual(base * 0.9 - 1);
            expect(delay).toBeLessThanOrEqual(base * 1.1 + 1);
        }
    });

    test("never give up on their own, however long the server is away", async () => {
        // The delays are zeroed so the loop runs now; `attempts` still comes from the defaults
        const context = new ReconnectContext({ retryDelay: 0, retryDelayMax: 0 });

        expect(context.options.attempts).toBe(-1);

        for (let attempt = 1; attempt <= 200; attempt++) {
            expect(context.allowed).toBe(true);
            await context.iterate();
            expect(context.attempts).toBe(attempt);
        }

        expect(context.allowed).toBe(true);
    });

    test("stop when reconnecting is turned off", () => {
        expect(new ReconnectContext(false).allowed).toBe(false);
        expect(new ReconnectContext({ enabled: false }).allowed).toBe(false);
    });

    test("respect an explicit attempt limit", () => {
        const context = new ReconnectContext({ attempts: 2 });

        expect(context.options.attempts).toBe(2);
        expect(context.allowed).toBe(true);
    });
});
