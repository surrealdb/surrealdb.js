import { afterEach, describe, expect, test } from "bun:test";
import { AuthResolverError, type ConnectOptions, type Session } from "../../../../sdk/src";
import { FakeClock } from "../__helpers__/fake-clock";
import { createJwtExpiringIn, deferred } from "../__helpers__/mock-fetch";
import { closeSessionClients, connect, serve } from "../__helpers__/session-engine";

const START = new Date("2030-01-01T00:00:00Z");

let clock: FakeClock | undefined;

afterEach(async () => {
    clock?.uninstall();
    clock = undefined;
    await closeSessionClients();
});

/** Let whatever is waiting on a promise run */
async function flush(): Promise<void> {
    for (let i = 0; i < 50; i++) await Promise.resolve();
}

/** Move the clock, and run what became due, and what that set going */
async function advance(milliseconds: number): Promise<void> {
    await clock?.advance(milliseconds, flush);
}

/** How many timers are waiting */
function timers(): number {
    return clock?.timers ?? 0;
}

type Outcome = "ok" | "fail";

/**
 * Connect with a callback which lives by a script: what it does on its first call, when the
 * connection is made, and on each call after, which are the renewals.
 */
async function renewing(options: {
    life: number;
    margin: number;
    script: (call: number, session: Session) => Outcome | Promise<Outcome>;
    connect?: Partial<ConnectOptions>;
    token?: (call: number) => string;
}) {
    clock = new FakeClock(START).install();

    const sessions: Session[] = [];
    let calls = 0;

    const { db, engine } = await connect(
        serve(),
        async (session) => {
            const call = ++calls;

            sessions.push(session);

            if ((await options.script(call, session)) === "fail") {
                throw new Error(`identity provider is down (call ${call})`);
            }

            return options.token?.(call) ?? createJwtExpiringIn(options.life, `token-${call}`);
        },
        { expiryMargin: options.margin, reconnect: { retryDelayJitter: 0 }, ...options.connect },
    );

    const errors: Error[] = [];
    const events: (unknown | null)[] = [];

    db.subscribe("error", (error) => errors.push(error));
    db.subscribe("auth", (tokens) => events.push(tokens));

    return {
        db,
        engine,
        errors,
        events,
        calls: () => calls,
        sessions,
        invalidations: () => engine.methods().filter((method) => method === "invalidate").length,
    };
}

describe("a renewal which fails", () => {
    test("is tried again, and recovers on the second attempt", async () => {
        const { db, errors, events, calls, invalidations } = await renewing({
            life: 100,
            margin: 10,
            script: (call) => (call === 2 ? "fail" : "ok"),
        });
        const first = db.accessToken;

        // The renewal is due a margin before the token expires, and fails
        await advance(90_000);
        expect(calls()).toBe(2);
        expect(errors).toHaveLength(1);
        expect(db.accessToken).toBe(first);

        // Not before the first backoff delay, which is two seconds here
        await advance(1_999);
        expect(calls()).toBe(2);

        await advance(1);
        expect(calls()).toBe(3);
        expect(db.accessToken).toBeString();
        expect(db.accessToken).not.toBe(first);
        expect(events.at(-1)).toMatchObject({ access: db.accessToken });
        expect(invalidations()).toBe(0);

        // Only the first failure is reported, and nothing is left over
        expect(errors).toHaveLength(1);
        expect(timers()).toBe(1);

        // And the new token is renewed in its turn, as if nothing had happened
        await advance(90_000);
        expect(calls()).toBe(4);
        expect(errors).toHaveLength(1);
    });

    test("is tried again with a longer delay each time, and recovers when the provider does", async () => {
        const { db, errors, calls, invalidations } = await renewing({
            life: 100,
            margin: 30,
            script: (call) => (call >= 2 && call <= 4 ? "fail" : "ok"),
        });
        const first = db.accessToken;

        // Renewal at 70 seconds, then 2, 4 and 8 seconds of delay
        await advance(70_000);
        expect(calls()).toBe(2);

        await advance(2_000);
        expect(calls()).toBe(3);

        await advance(3_999);
        expect(calls()).toBe(3);
        await advance(1);
        expect(calls()).toBe(4);

        await advance(7_999);
        expect(calls()).toBe(4);
        await advance(1);
        expect(calls()).toBe(5);

        expect(db.accessToken).not.toBe(first);
        expect(invalidations()).toBe(0);

        // Three attempts failed, and were reported once
        expect(errors).toHaveLength(1);
        expect(errors[0]).toBeInstanceOf(AuthResolverError);
    });

    test("is tried until the token expires, and the session is invalidated exactly then", async () => {
        const { db, engine, errors, events, calls, invalidations } = await renewing({
            life: 100,
            margin: 10,
            script: (call) => (call === 1 ? "ok" : "fail"),
        });

        // Renewal at 90 seconds, retries at 92 and 96. The next, eight seconds on, would be after
        // the token has expired, so the session waits for that instead
        await advance(90_000);
        await advance(2_000);
        await advance(4_000);
        expect(calls()).toBe(4);
        expect(errors).toHaveLength(1);
        expect(invalidations()).toBe(0);

        await advance(3_999);
        expect(db.accessToken).toBeString();
        expect(invalidations()).toBe(0);
        expect(calls()).toBe(4);

        await advance(1);
        expect(db.accessToken).toBeUndefined();
        expect(invalidations()).toBe(1);
        expect(events.at(-1)).toBeNull();
        expect(engine.methods().at(-1)).toBe("invalidate");

        // Reported when the first attempt failed, and again as the session is invalidated, and
        // not for the attempts in between
        expect(errors).toHaveLength(2);
        expect(errors.every((error) => error instanceof AuthResolverError)).toBeTrue();
        expect(timers()).toBe(0);

        // Nothing runs after it
        await advance(600_000);
        expect(calls()).toBe(4);
        expect(invalidations()).toBe(1);
    });

    test("is not tried again when the token has expired by the time the attempt fails", async () => {
        const gate = deferred<Outcome>();
        const { db, errors, calls, invalidations } = await renewing({
            life: 100,
            margin: 10,
            script: (call) => (call === 2 ? gate.promise : "ok"),
        });

        await advance(90_000);
        expect(calls()).toBe(2);

        // The attempt does not answer until the token is gone
        await advance(20_000);
        expect(db.accessToken).toBeString();

        gate.resolve("fail");
        await flush();

        expect(db.accessToken).toBeUndefined();
        expect(invalidations()).toBe(1);
        expect(errors).toHaveLength(2);
        expect(timers()).toBe(0);

        await advance(600_000);
        expect(calls()).toBe(2);
    });

    test("is not tried again when retrying is turned off with the reconnect option", async () => {
        const { db, errors, calls, invalidations } = await renewing({
            life: 100,
            margin: 10,
            script: (call) => (call === 1 ? "ok" : "fail"),
            connect: { reconnect: false },
        });

        await advance(90_000);
        await advance(9_999);
        expect(calls()).toBe(2);
        expect(db.accessToken).toBeString();

        // Invalidated at expiry, which is what happens when there is nothing to try again
        await advance(1);
        expect(db.accessToken).toBeUndefined();
        expect(invalidations()).toBe(1);
        expect(errors).toHaveLength(2);
        expect(calls()).toBe(2);
    });

    test("uses the delays of the reconnect option", async () => {
        const { calls } = await renewing({
            life: 1000,
            margin: 100,
            script: (call) => (call === 1 ? "ok" : "fail"),
            connect: {
                reconnect: {
                    retryDelay: 10_000,
                    retryDelayMultiplier: 1,
                    retryDelayMax: 60_000,
                    retryDelayJitter: 0,
                },
            },
        });

        await advance(900_000);
        expect(calls()).toBe(2);

        await advance(9_999);
        expect(calls()).toBe(2);
        await advance(1);
        expect(calls()).toBe(3);
        await advance(10_000);
        expect(calls()).toBe(4);
    });

    test("is not bound by the number of reconnect attempts", async () => {
        const { calls } = await renewing({
            life: 1000,
            margin: 600,
            script: (call) => (call === 1 ? "ok" : "fail"),
            connect: {
                reconnect: {
                    attempts: 1,
                    retryDelay: 1000,
                    retryDelayMultiplier: 1,
                    retryDelayJitter: 0,
                },
            },
        });

        // The renewal at 600 seconds fails, and is tried again every second for the 400 left
        await advance(600_000);

        // A second at a time, as what is tried again is scheduled once an attempt has failed
        for (let second = 0; second < 60; second++) await advance(1_000);

        // One attempt after the first is what attempts: 1 would allow, and this is a good deal more
        expect(calls()).toBeGreaterThan(40);
    });

    test("is tried again from a clean slate for the next token", async () => {
        const { calls, errors } = await renewing({
            life: 100,
            margin: 10,
            // Fails at 90s and 92s, recovers at 96s, fails again for the next token at 186s
            script: (call) => (call === 2 || call === 3 || call === 5 ? "fail" : "ok"),
        });

        await advance(90_000);
        await advance(2_000);
        await advance(4_000);
        expect(calls()).toBe(4);
        expect(errors).toHaveLength(1);

        // 90 seconds after the token which was issued at 96 seconds
        await advance(90_000);
        expect(calls()).toBe(5);
        expect(errors).toHaveLength(2);

        // The backoff starts over at two seconds
        await advance(2_000);
        expect(calls()).toBe(6);
    });

    describe("is cancelled", () => {
        test("when the user signs in again meanwhile", async () => {
            const { db, errors, calls, invalidations } = await renewing({
                life: 100,
                margin: 10,
                script: (call) => (call === 1 ? "ok" : "fail"),
            });

            await advance(90_000);
            expect(calls()).toBe(2);
            expect(errors).toHaveLength(1);

            // A retry is waiting. Signing in replaces what it was for
            await db.signin({ username: "tobie", password: "secret" });
            expect(db.accessToken).toBe("signin-token");

            // The token which was signed in with has no expiry, so nothing is left to run
            expect(timers()).toBe(0);

            await advance(600_000);
            expect(calls()).toBe(2);
            expect(errors).toHaveLength(1);
            expect(invalidations()).toBe(0);
        });

        test("when the user signs in while an attempt is in flight", async () => {
            const gate = deferred<Outcome>();
            const { db, errors, calls } = await renewing({
                life: 100,
                margin: 10,
                script: (call) => (call === 2 ? gate.promise : "ok"),
            });

            await advance(90_000);
            expect(calls()).toBe(2);

            await db.signin({ username: "tobie", password: "secret" });

            // The attempt which is now of no use fails, and is not reported or tried again
            gate.resolve("fail");
            await flush();

            expect(errors).toHaveLength(0);
            expect(db.accessToken).toBe("signin-token");

            await advance(600_000);
            expect(calls()).toBe(2);
        });

        test("when the session is invalidated", async () => {
            const { db, errors, calls } = await renewing({
                life: 100,
                margin: 10,
                script: (call) => (call === 1 ? "ok" : "fail"),
            });

            await advance(90_000);
            expect(errors).toHaveLength(1);

            await db.invalidate();
            expect(timers()).toBe(0);

            await advance(600_000);
            expect(calls()).toBe(2);
            expect(errors).toHaveLength(1);
        });

        test("when the session which was being renewed is closed", async () => {
            const { db, calls, sessions, errors, invalidations } = await renewing({
                life: 100,
                margin: 10,
                // The renewals of the default session succeed, and those of the fork fail
                script: (_, session) => (session === undefined ? "ok" : "fail"),
            });

            const fork = await db.forkSession();

            // The fork was given the token of the session which it was forked from
            expect(fork.accessToken).toBe(db.accessToken);

            await advance(90_000);
            expect(sessions.filter((session) => session === fork.session)).toHaveLength(1);
            expect(errors).toHaveLength(1);

            const attempts = calls();

            // The default session renews itself, and the fork is waiting to try again
            expect(timers()).toBe(2);

            await fork.closeSession();
            expect(timers()).toBe(1);

            await advance(600_000);

            // Neither tried again nor invalidated, which would be on a session which is gone
            expect(sessions.filter((session) => session === fork.session)).toHaveLength(1);
            expect(errors).toHaveLength(1);
            expect(invalidations()).toBe(0);
            expect(calls()).toBeGreaterThanOrEqual(attempts);
        });

        test("when the connection is closed", async () => {
            const { db, calls, errors } = await renewing({
                life: 100,
                margin: 10,
                script: (call) => (call === 1 ? "ok" : "fail"),
            });

            await advance(90_000);
            expect(errors).toHaveLength(1);

            await db.close();
            expect(timers()).toBe(0);

            await advance(600_000);
            expect(calls()).toBe(2);
            expect(errors).toHaveLength(1);
        });
    });

    test("is not scheduled for a token without an expiry, which is never renewed", async () => {
        const { db, calls, errors } = await renewing({
            life: 100,
            margin: 10,
            script: () => "ok",
            token: () => "opaque-token",
        });

        expect(db.accessToken).toBe("opaque-token");
        expect(timers()).toBe(0);

        await advance(86_400_000);
        expect(calls()).toBe(1);
        expect(errors).toHaveLength(0);
    });

    test("clamps long renewal delays to 1 day and re-arms until due", async () => {
        const THREE_DAYS = 3 * 24 * 60 * 60;
        const ONE_DAY_MS = 24 * 60 * 60 * 1000;

        const { calls } = await renewing({
            life: THREE_DAYS,
            margin: 60,
            script: () => "ok",
        });

        expect(calls()).toBe(1);
        expect(timers()).toBe(1);

        // After 1 day, it re-arms without firing renewal yet
        await advance(ONE_DAY_MS);
        expect(calls()).toBe(1);
        expect(timers()).toBe(1);

        // After 2 days, re-arms again
        await advance(ONE_DAY_MS);
        expect(calls()).toBe(1);
        expect(timers()).toBe(1);

        // Advance to just before the renewal is due
        const remainingToDue = (THREE_DAYS - 60) * 1000 - 2 * ONE_DAY_MS;
        await advance(remainingToDue - 1);
        expect(calls()).toBe(1);

        // Advance 1ms to reach the renewal time
        await advance(1);
        expect(calls()).toBe(2);
    });
});
