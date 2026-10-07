import { afterEach, describe, expect, test } from "bun:test";
import { AuthResolverError, Table, Uuid } from "../../../../sdk/src";
import { FakeClock } from "../__helpers__/fake-clock";
import { rejection } from "../__helpers__/mock-client";
import { createJwtExpiringIn, deferred } from "../__helpers__/mock-fetch";
import {
    closeSessionClients,
    connect,
    type Handler,
    serve,
    until,
} from "../__helpers__/session-engine";

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

const table = new Table("thing");

const statement = (result: unknown = null) => ({ status: "OK", time: "1ms", result });

/**
 * What a 3.x server answers a transaction with, which is a result for the BEGIN and the COMMIT
 * around those of the statements, and what it answers anything else with.
 */
const committing =
    (statements: number, inner: Handler = serve()): Handler =>
    (request) =>
        request.method === "query"
            ? [statement(), ...Array.from({ length: statements }, () => statement({})), statement()]
            : inner(request);

/** A server which does not answer a query, or a transaction */
const silent =
    (inner: Handler = serve()): Handler =>
    (request) =>
        request.method === "query" ? new Promise(() => {}) : inner(request);

describe("a request on a session, which is abandoned while its credential is resolved", () => {
    test("ends with the reason of the signal, and nothing is sent", async () => {
        const gate = deferred<string>();
        const { db, engine } = await connect(serve(), {
            resolve: () => gate.promise,
            when: "request",
        });
        const controller = new AbortController();
        const reason = new Error("client went away");
        const call = rejection(db.query("RETURN 1").signal(controller.signal));

        await flush();
        controller.abort(reason);

        expect(await call).toBe(reason);
        expect(engine.methods()).not.toContain("query");
        expect(engine.methods()).not.toContain("authenticate");
    });

    test("leaves the credential which was being resolved to be applied in full", async () => {
        const gate = deferred<string>();
        let calls = 0;
        const { db, engine } = await connect(serve(), {
            resolve: () => {
                calls++;
                return gate.promise;
            },
            when: "request",
            cache: "until-expiry",
        });
        const controller = new AbortController();
        const first = rejection(db.query("RETURN 1").signal(controller.signal));

        await flush();
        controller.abort(new Error("client went away"));
        await first;

        const token = createJwtExpiringIn(3600);

        gate.resolve(token);
        await until(() => engine.methods().includes("authenticate"));
        await flush();

        // Not half done: the session holds the credential, and is not asked to authenticate again
        expect(db.accessToken).toBe(token);

        await db.query("RETURN 2");

        expect(calls).toBe(1);
        expect(engine.methods().filter((m) => m === "authenticate")).toHaveLength(1);
        expect(engine.methods().filter((m) => m === "query")).toHaveLength(1);
    });

    test("is not held up by it, for the next request which resolves for itself", async () => {
        const gates = [deferred<string>(), deferred<string>()];
        let calls = 0;
        const { db, engine } = await connect(serve(), {
            resolve: () => gates[calls++].promise,
            when: "request",
        });
        const controller = new AbortController();
        const first = rejection(db.query("RETURN 1").signal(controller.signal));

        await flush();
        controller.abort(new Error("client went away"));
        await first;

        const next = db.query("RETURN 2").collect();

        // The resolution of the abandoned request is still being waited on, so the next is queued
        // behind it and resolves for itself once that has finished
        gates[0].resolve("for-the-first");
        await until(() => calls === 2);
        gates[1].resolve("for-the-second");
        await next;

        expect(db.accessToken).toBe("for-the-second");
        expect(engine.methods().filter((m) => m === "query")).toHaveLength(1);
    });

    test("is ended by a request timeout with a TimeoutError", async () => {
        const gate = deferred<string>();
        const { db } = await connect(serve(), { resolve: () => gate.promise, when: "request" });

        const error = await rejection(db.query("RETURN 1").requestTimeout(25));

        expect(error.name).toBe("TimeoutError");
    });

    test("is ended by the request timeout of the connection", async () => {
        const gate = deferred<string>();
        const { db } = await connect(
            serve(),
            { resolve: () => gate.promise, when: "request" },
            { requestTimeout: 25 },
        );

        const error = await rejection(db.query("RETURN 1"));

        expect(error.name).toBe("TimeoutError");
    });

    test("is ended by a scope which is bound to a signal", async () => {
        const gate = deferred<string>();
        const { db, engine } = await connect(serve(), {
            resolve: () => gate.promise,
            when: "request",
        });
        const controller = new AbortController();
        const reason = new Error("client went away");
        const scoped = db.withSignal(controller.signal);
        const calls = [
            rejection(scoped.query("RETURN 1")),
            rejection(scoped.select(table)),
            rejection(scoped.create(table)),
        ];

        await flush();
        controller.abort(reason);

        expect(await Promise.all(calls)).toEqual([reason, reason, reason]);
        expect(engine.methods()).not.toContain("query");
    });

    test("is won by the abort when the resolver fails as well", async () => {
        for (const abortFirst of [true, false]) {
            const gate = deferred<string>();
            const { db } = await connect(serve(), {
                resolve: () => gate.promise,
                when: "request",
            });
            const controller = new AbortController();
            const reason = new Error("client went away");
            const call = rejection(db.query("RETURN 1").signal(controller.signal));

            await flush();

            if (abortFirst) {
                controller.abort(reason);
                gate.reject(new Error("vault is sealed"));
            } else {
                gate.reject(new Error("vault is sealed"));
                controller.abort(reason);
            }

            expect(await call).toBe(reason);
        }
    });

    test("is an AuthResolverError when the resolver fails and nothing aborts", async () => {
        const failure = new Error("vault is sealed");
        const { db, engine } = await connect(serve(), {
            resolve: () => {
                throw failure;
            },
            when: "request",
        });
        const controller = new AbortController();

        const error = await rejection(db.query("RETURN 1").signal(controller.signal));

        expect(error).toBeInstanceOf(AuthResolverError);
        expect(error.cause).toBe(failure);
        expect(engine.methods()).not.toContain("query");
    });

    test("does not ask for a credential when the signal has aborted already", async () => {
        let calls = 0;
        const { db } = await connect(serve(), {
            resolve: () => {
                calls++;
                return "token";
            },
            when: "request",
        });
        const controller = new AbortController();

        controller.abort(new Error("client went away"));

        await rejection(db.query("RETURN 1").signal(controller.signal));

        expect(calls).toBe(0);
    });
});

describe("a request on a session, which is abandoned while the session is authenticated", () => {
    test("ends with the reason of the signal, and the authentication is not left half done", async () => {
        const gate = deferred<null>();
        const token = createJwtExpiringIn(3600);
        const { db, engine } = await connect(serve({ authenticate: () => gate.promise as never }), {
            resolve: () => token,
            when: "request",
            cache: "until-expiry",
        });
        const controller = new AbortController();
        const reason = new Error("client went away");
        const call = rejection(db.query("RETURN 1").signal(controller.signal));

        await until(() => engine.methods().includes("authenticate"));
        controller.abort(reason);

        expect(await call).toBe(reason);
        expect(engine.methods()).not.toContain("query");

        // The server answers after all, and the session is as authenticated as it was asked to be
        gate.resolve(null);
        await flush();
        await db.query("RETURN 2");

        expect(db.accessToken).toBe(token);
        expect(engine.methods().filter((m) => m === "authenticate")).toHaveLength(1);
        expect(engine.methods().filter((m) => m === "query")).toHaveLength(1);
    });

    test("ends with a TimeoutError by the request timeout", async () => {
        const gate = deferred<null>();
        const { db } = await connect(serve({ authenticate: () => gate.promise as never }), {
            resolve: () => "token",
            when: "request",
        });

        const error = await rejection(db.query("RETURN 1").requestTimeout(25));

        expect(error.name).toBe("TimeoutError");
    });
});

describe("requests which are queued for a resolution, one at a time", () => {
    test("a request which is abandoned while it waits for its turn never has one", async () => {
        const gate = deferred<string>();
        let calls = 0;
        const { db, engine } = await connect(serve(), {
            resolve: () => (calls++ === 0 ? gate.promise : "for-the-third"),
            when: "request",
        });
        const first = db.query("RETURN 1").collect();

        await until(() => calls === 1);

        const controller = new AbortController();
        const reason = new Error("client went away");
        const queued = rejection(db.query("RETURN 2").signal(controller.signal));

        await flush();
        controller.abort(reason);

        expect(await queued).toBe(reason);

        gate.resolve("for-the-first");
        await first;
        await flush();

        // The resolver was never asked for the one which went away
        expect(calls).toBe(1);
        expect(engine.methods().filter((m) => m === "query")).toHaveLength(1);

        // And the queue is not left blocked
        await db.query("RETURN 3");

        expect(calls).toBe(2);
        expect(engine.methods().filter((m) => m === "query")).toHaveLength(2);
    });
});

describe("transactions on a session with credentials which are resolved for requests", () => {
    test("one which is begun is authenticated before it begins", async () => {
        const token = createJwtExpiringIn(3600);
        const id = Uuid.v4();
        const { db, engine } = await connect(
            (request) => (request.method === "begin" ? id : serve()(request)),
            { resolve: () => token, when: "request" },
        );

        const transaction = await db.beginTransaction();

        expect(engine.methods().filter((m) => m !== "use")).toEqual(["authenticate", "begin"]);
        expect(db.accessToken).toBe(token);
        expect(transaction).toBeDefined();
    });

    test("one which is begun is abandoned with the wait for the resolver, and not left open", async () => {
        const gate = deferred<string>();
        const id = Uuid.v4();
        const { db, engine } = await connect(
            (request) => (request.method === "begin" ? id : serve()(request)),
            { resolve: () => gate.promise, when: "request" },
        );
        const controller = new AbortController();
        const reason = new Error("client went away");
        const call = rejection(db.withSignal(controller.signal).beginTransaction());

        await flush();
        controller.abort(reason);

        expect(await call).toBe(reason);

        // The resolver finishes after all, which lets the transaction begin for nobody, so it is
        // cancelled at once, rather than left holding what it has taken
        gate.resolve(createJwtExpiringIn(3600));
        await until(() => engine.methods().includes("cancel"));

        expect(engine.methods().filter((m) => m !== "use")).toEqual([
            "authenticate",
            "begin",
            "cancel",
        ]);
        expect(engine.sent.find((r) => r.method === "cancel")?.params).toEqual([id]);
    });

    test("one which is passed as a list of queries is authenticated, and sent as one request", async () => {
        const token = createJwtExpiringIn(3600);
        const { db, engine } = await connect(committing(2), {
            resolve: () => token,
            when: "request",
        });

        const results = await db.transaction([db.create(table), db.create(table)]);

        expect(results).toHaveLength(2);
        expect(engine.methods().filter((m) => m !== "use")).toEqual(["authenticate", "query"]);
        expect(db.accessToken).toBe(token);
    });

    test("one which is passed as a list of queries is abandoned while the credential is resolved", async () => {
        const gate = deferred<string>();
        const { db, engine } = await connect(committing(1), {
            resolve: () => gate.promise,
            when: "request",
        });
        const controller = new AbortController();
        const reason = new Error("client went away");
        const direct = rejection(db.transaction([db.create(table)], { signal: controller.signal }));
        const scoped = rejection(db.withSignal(controller.signal).transaction([db.create(table)]));

        await flush();
        controller.abort(reason);

        expect(await direct).toBe(reason);
        expect(await scoped).toBe(reason);
        expect(engine.methods()).not.toContain("query");
    });

    test("one which is passed as a list of queries is held to the request timeout", async () => {
        const gate = deferred<string>();
        const { db } = await connect(committing(1), {
            resolve: () => gate.promise,
            when: "request",
        });

        const error = await rejection(db.transaction([db.create(table)], { requestTimeout: 25 }));

        expect(error.name).toBe("TimeoutError");
    });

    test("one which is passed as a list of queries is abandoned while it is in flight", async () => {
        const token = createJwtExpiringIn(3600);
        const { db, engine } = await connect(silent(), { resolve: () => token, when: "request" });
        const controller = new AbortController();
        const reason = new Error("client went away");
        const call = rejection(db.transaction([db.create(table)], { signal: controller.signal }));

        await until(() => engine.methods().includes("query"));
        controller.abort(reason);

        expect(await call).toBe(reason);
    });

    test("one as someone else is refused, rather than run as the session", async () => {
        const { db, engine } = await connect(committing(1), {
            resolve: () => "token",
            when: "request",
        });

        const error = await rejection(db.transaction([db.create(table)], { as: "other-token" }));

        expect(error.name).toBe("UnsupportedFeatureError");
        expect(engine.methods()).not.toContain("query");
    });
});

describe("renewal of a session, and requests which are abandoned", () => {
    const START = new Date("2030-01-01T00:00:00Z");

    /** A callback which lives by a script, with a connection whose requests are not answered */
    async function renewing(script: (call: number) => "ok" | "fail") {
        clock = new FakeClock(START).install();

        let calls = 0;

        const { db, engine } = await connect(
            silent(),
            async () => {
                const call = ++calls;

                if (script(call) === "fail") throw new Error(`identity provider is down (${call})`);

                return createJwtExpiringIn(100, `token-${call}`);
            },
            { expiryMargin: 10, reconnect: { retryDelayJitter: 0 } },
        );

        return { db, engine, calls: () => calls };
    }

    /** Move the clock, and run what became due, and what that set going */
    const advance = (milliseconds: number) => clock?.advance(milliseconds, flush);

    const authentications = (engine: { methods(): string[] }) =>
        engine.methods().filter((m) => m === "authenticate").length;

    test("a request which is abandoned does not stop the session from being renewed", async () => {
        const { db, engine, calls } = await renewing(() => "ok");
        const controller = new AbortController();
        const reason = new Error("client went away");
        const call = rejection(db.query("RETURN 1").signal(controller.signal));

        await flush();
        controller.abort(reason);

        expect(await call).toBe(reason);
        expect(authentications(engine)).toBe(1);

        await advance(90_000);

        expect(calls()).toBe(2);
        expect(authentications(engine)).toBe(2);
        expect(db.accessToken).toBeString();
    });

    test("a request which is abandoned while a renewal waits to be retried leaves the retry alone", async () => {
        const { db, engine, calls } = await renewing((call) => (call === 2 ? "fail" : "ok"));
        const first = db.accessToken;
        const controller = new AbortController();

        // The renewal fails, and is to be tried again after two seconds
        await advance(90_000);
        expect(calls()).toBe(2);

        const call = rejection(db.query("RETURN 1").signal(controller.signal));

        await flush();
        controller.abort(new Error("client went away"));
        await call;

        await advance(1_999);
        expect(calls()).toBe(2);

        await advance(1);
        expect(calls()).toBe(3);
        expect(db.accessToken).not.toBe(first);
        expect(authentications(engine)).toBe(2);
    });

    test("signals which are aborted by the dozen do not cancel the next renewal", async () => {
        const { db, calls } = await renewing(() => "ok");

        for (let i = 0; i < 12; i++) {
            const controller = new AbortController();
            const call = rejection(db.query("RETURN 1").signal(controller.signal));

            await flush();
            controller.abort(new Error(`client went away (${i})`));
            await call;
        }

        await advance(90_000);
        expect(calls()).toBe(2);

        await advance(90_000);
        expect(calls()).toBe(3);
    });

    test("closing the connection stops the renewal, whatever is left of the requests", async () => {
        const { db, engine, calls } = await renewing(() => "ok");
        const controller = new AbortController();
        const call = rejection(db.query("RETURN 1").signal(controller.signal));

        await flush();
        await db.close();
        controller.abort(new Error("client went away"));
        await call;
        await advance(200_000);

        expect(calls()).toBe(1);
        expect(authentications(engine)).toBe(1);
        expect(clock?.timers).toBe(0);
    });
});
