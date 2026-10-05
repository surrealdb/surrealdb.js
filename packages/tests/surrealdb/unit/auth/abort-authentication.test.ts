import { afterEach, describe, expect, test } from "bun:test";
import {
    AuthenticationError,
    AuthResolverError,
    ExpressionError,
    RecordId,
    type Surreal,
    Table,
} from "../../../../sdk/src";
import { FakeClock } from "../__helpers__/fake-clock";
import {
    closeClients,
    connect,
    queries,
    rejection,
    server,
    signins,
} from "../__helpers__/mock-client";
import {
    bearerOf,
    createJwtExpiringIn,
    deferred,
    type MockHandler,
    queryResult,
} from "../__helpers__/mock-fetch";

afterEach(async () => {
    await closeClients();
});

/** Let whatever is waiting on a promise run */
async function flush(): Promise<void> {
    for (let i = 0; i < 50; i++) await Promise.resolve();
}

/** Wait until the condition holds, polling in microtasks and then in time */
async function until(condition: () => boolean, timeout = 2000): Promise<void> {
    const start = Date.now();

    while (!condition()) {
        if (Date.now() - start > timeout) throw new Error("The condition was not met in time");
        await Bun.sleep(1);
    }
}

/** A server which never answers a query */
const silent: MockHandler = (request) =>
    request.rpc?.method === "query"
        ? new Promise(() => {})
        : { result: request.rpc?.method === "signin" ? "signin-token" : null };

/**
 * What a 3.x server answers a transaction with, which is a result for the BEGIN and the COMMIT
 * around those of the statements, and what it answers anything else with.
 */
const committing =
    (statements: number, inner: MockHandler = server({})): MockHandler =>
    (request) =>
        request.rpc?.method === "query"
            ? queryResult(null, ...Array(statements).fill({ ok: true }), null)
            : inner(request);

const table = new Table("thing");
const record = new RecordId("thing", 1);

// What each builder is, as something which can be given an identity and a signal in any order
type Chainable = PromiseLike<unknown> & {
    as(credential: string | object): Chainable;
    signal(signal: AbortSignal | undefined): Chainable;
    requestTimeout(milliseconds: number): Chainable;
};

const builders: [string, (db: Surreal) => unknown][] = [
    ["query", (db) => db.query("RETURN 1")],
    ["select", (db) => db.select(table)],
    ["create", (db) => db.create(table)],
    ["update", (db) => db.update(record)],
    ["upsert", (db) => db.upsert(record)],
    ["delete", (db) => db.delete(record)],
    ["insert", (db) => db.insert(table, { a: 1 })],
    ["relate", (db) => db.relate(record, new Table("edge"), new RecordId("thing", 2))],
    ["run", (db) => db.run("fn::example")],
    ["auth", (db) => db.auth()],
    ["api", (db) => db.api().get("/example")],
];

const orders: [string, (b: Chainable, token: string, signal: AbortSignal) => Chainable][] = [
    ["as then signal", (b, t, s) => b.as(t).signal(s)],
    ["signal then as", (b, t, s) => b.signal(s).as(t)],
    ["as, request timeout, signal", (b, t, s) => b.as(t).requestTimeout(5_000).signal(s)],
    ["request timeout, signal, as", (b, t, s) => b.requestTimeout(5_000).signal(s).as(t)],
    ["signal, as, request timeout", (b, t, s) => b.signal(s).as(t).requestTimeout(5_000)],
];

describe("a call made as someone else, which may be abandoned", () => {
    for (const [name, build] of builders) {
        for (const [order, compose] of orders) {
            test(`${name}: ${order}`, async () => {
                const { db, mock } = await connect(server({}), () => "session-token");
                const controller = new AbortController();

                await compose(build(db) as Chainable, "call-token", controller.signal);

                const [sent] = queries(mock.calls);

                // It was made as the identity it was asked to be, and could have been abandoned
                expect(queries(mock.calls)).toHaveLength(1);
                expect(bearerOf(sent)).toBe("call-token");
                expect(sent.init.signal).toBeInstanceOf(AbortSignal);
            });
        }

        test(`${name}: a signal which has aborted already sends nothing, as whoever it is`, async () => {
            const { db, mock } = await connect(server({}), () => "session-token");
            const controller = new AbortController();
            const reason = new Error("client went away");

            controller.abort(reason);

            const error = await rejection(
                (build(db) as Chainable).as("call-token").signal(controller.signal),
            );

            expect(error).toBe(reason);
            expect(queries(mock.calls)).toHaveLength(0);
        });
    }

    test("is abandoned with the reason of the signal, while it is waiting for the server", async () => {
        const { db, mock } = await connect(silent, () => "session-token");
        const controller = new AbortController();
        const reason = new Error("client went away");
        const call = rejection(db.select(table).as("call-token").signal(controller.signal));

        await until(() => queries(mock.calls).length === 1);
        controller.abort(reason);

        expect(await call).toBe(reason);
        expect(bearerOf(queries(mock.calls)[0])).toBe("call-token");
    });

    test("is abandoned with a TimeoutError by a request timeout, as the session is", async () => {
        const { db } = await connect(silent, () => "session-token");

        const error = await rejection(db.select(table).as("call-token").requestTimeout(25));

        expect(error.name).toBe("TimeoutError");
    });

    test("is abandoned by the request timeout of the connection too", async () => {
        const { db } = await connect(silent, () => "session-token", { requestTimeout: 25 });

        const error = await rejection(db.query("RETURN 1").as("call-token"));

        expect(error.name).toBe("TimeoutError");
    });

    test("is abandoned while its details are exchanged for a token, and sends nothing after", async () => {
        const gate = deferred<{ result: string }>();
        const { db, mock } = await connect(
            (request) =>
                request.rpc?.method === "signin"
                    ? gate.promise
                    : queryResult({ body: {}, status: 200 }),
            undefined,
        );
        const controller = new AbortController();
        const reason = new Error("client went away");
        const call = rejection(
            db
                .select(table)
                .as({ access: "user", variables: { id: 1 } })
                .signal(controller.signal),
        );

        await until(() => signins(mock.calls).length === 1);
        controller.abort(reason);

        expect(await call).toBe(reason);

        // The exchange is not waited for, and nothing is made of what it comes back with
        gate.resolve({ result: "late-token" });
        await flush();

        expect(queries(mock.calls)).toHaveLength(0);
    });

    test("is the same through a scope bound to a signal", async () => {
        const { db, mock } = await connect(silent, () => "session-token");
        const controller = new AbortController();
        const reason = new Error("client went away");
        const scoped = db.withSignal(controller.signal);
        const calls = [
            rejection(scoped.select(table).as("call-token")),
            rejection(scoped.query("RETURN 1").as("call-token")),
            rejection(scoped.create(table).as("call-token")),
            rejection(scoped.auth().as("call-token")),
        ];

        await until(() => queries(mock.calls).length === 4);
        controller.abort(reason);

        expect(await Promise.all(calls)).toEqual([reason, reason, reason, reason]);
        expect(queries(mock.calls).map(bearerOf)).toEqual(Array(4).fill("call-token"));
    });

    test("is made through a scope as the identity it was asked to be", async () => {
        const { db, mock } = await connect(server({}), () => "session-token");
        const controller = new AbortController();
        const scoped = db.withSignal(controller.signal).withSignal(AbortSignal.timeout(60_000));

        await scoped.select(table).as("call-token");
        await scoped.select(table);

        const [as, plain] = queries(mock.calls);

        expect(bearerOf(as)).toBe("call-token");
        expect(bearerOf(plain)).toBe("session-token");
        expect(as.init.signal).toBeInstanceOf(AbortSignal);
    });
});

describe("a list of queries, and a transaction, which are run as someone else", () => {
    test("a list of queries is run as the identity which is asked of the whole", async () => {
        const { db, mock } = await connect(server({}), () => "session-token");
        const controller = new AbortController();

        await db
            .query(["RETURN 1", db.select(table), "RETURN 2"])
            .as("call-token")
            .signal(controller.signal);

        expect(queries(mock.calls)).toHaveLength(1);
        expect(bearerOf(queries(mock.calls)[0])).toBe("call-token");
    });

    test("a part of it which is run as someone else is refused, rather than run as the session", async () => {
        const { db, mock } = await connect(server({}), () => "session-token");

        for (const part of [
            db.select(table).as("call-token"),
            db.select(table).as("call-token").limit(5),
            db.query("RETURN 1").as("call-token").json(),
            db.select(table).signal(new AbortController().signal).as("call-token"),
        ]) {
            // It is the combining which fails, before anything is sent
            let error: unknown;

            try {
                db.query([part, "RETURN 2"]);
            } catch (thrown) {
                error = thrown;
            }

            expect(error).toBeInstanceOf(ExpressionError);
            expect((error as Error).message).toContain(".as()");
        }

        expect(queries(mock.calls)).toHaveLength(0);
    });

    test("a query which was made by hand is not mistaken for one which is run as someone else", async () => {
        const { db, mock } = await connect(server({}), () => "session-token");
        const handmade = db.query("RETURN 1").inner;

        // The same query is given an identity elsewhere, and is still the caller's own here
        await db.query(handmade).as("call-token");
        await db.query([handmade, "RETURN 2"]);

        expect(queries(mock.calls).map(bearerOf)).toEqual(["call-token", "session-token"]);
    });

    test("a transaction takes the identity it is to run as", async () => {
        const { db, mock } = await connect(committing(1), () => "session-token");

        await db.transaction([db.create(table)], { as: "call-token" });

        expect(queries(mock.calls)).toHaveLength(1);
        expect(bearerOf(queries(mock.calls)[0])).toBe("call-token");
        expect(String(queries(mock.calls)[0].rpc?.params?.[0])).toContain("BEGIN");
    });

    test("a transaction as someone else may be abandoned, through its options or a scope", async () => {
        const { db, mock } = await connect(silent, () => "session-token");
        const controller = new AbortController();
        const reason = new Error("client went away");

        const direct = rejection(
            db.transaction([db.create(table)], { as: "call-token", signal: controller.signal }),
        );
        const scoped = rejection(
            db.withSignal(controller.signal).transaction([db.create(table)], { as: "call-token" }),
        );

        await until(() => queries(mock.calls).length === 2);
        controller.abort(reason);

        expect(await direct).toBe(reason);
        expect(await scoped).toBe(reason);
        expect(queries(mock.calls).map(bearerOf)).toEqual(["call-token", "call-token"]);
    });

    test("a transaction as someone else is held to the request timeout", async () => {
        const { db } = await connect(silent, () => "session-token");

        const error = await rejection(
            db.transaction([db.create(table)], { as: "call-token", requestTimeout: 25 }),
        );

        expect(error.name).toBe("TimeoutError");
    });

    test("a transaction with a credential which cannot be used is refused", async () => {
        const { db, mock } = await connect(server({}), () => "session-token");

        for (const credential of ["", null, 0, []]) {
            const error = await rejection(
                db.transaction([db.create(table)], { as: credential as never }),
            );

            expect(error).toBeInstanceOf(AuthenticationError);
        }

        expect(queries(mock.calls)).toHaveLength(0);
    });

    test("a transaction takes the credential which is resolved for requests, in the one request", async () => {
        const token = createJwtExpiringIn(3600);
        let calls = 0;
        const { db, mock } = await connect(committing(2), {
            resolve: () => {
                calls++;
                return token;
            },
            when: "request",
        });

        await db.transaction([db.create(table), db.create(table)]);

        expect(queries(mock.calls)).toHaveLength(1);
        expect(bearerOf(queries(mock.calls)[0])).toBe(token);
        expect(calls).toBe(1);
    });
});

describe("a credential which is resolved for a request, which may be abandoned", () => {
    test("the wait for the resolver ends with the reason of the signal, and nothing is sent", async () => {
        const gate = deferred<string>();
        const { db, mock } = await connect(server({}), {
            resolve: () => gate.promise,
            when: "request",
        });
        const controller = new AbortController();
        const reason = new Error("client went away");
        const call = rejection(db.query("RETURN 1").signal(controller.signal));

        await flush();
        controller.abort(reason);

        expect(await call).toBe(reason);

        gate.resolve("late-token");
        await flush();

        expect(queries(mock.calls)).toHaveLength(0);
    });

    test("a request timeout ends it with a TimeoutError", async () => {
        const gate = deferred<string>();
        const { db } = await connect(server({}), { resolve: () => gate.promise, when: "request" });

        const error = await rejection(db.query("RETURN 1").requestTimeout(25));

        expect(error.name).toBe("TimeoutError");
    });

    test("the request timeout of the connection ends it too", async () => {
        const gate = deferred<string>();
        const { db } = await connect(
            server({}),
            { resolve: () => gate.promise, when: "request" },
            { requestTimeout: 25 },
        );

        const error = await rejection(db.query("RETURN 1"));

        expect(error.name).toBe("TimeoutError");
    });

    test("an abort wins over a resolver which fails, whichever of them is first", async () => {
        for (const abortFirst of [true, false]) {
            const gate = deferred<string>();
            const { db } = await connect(server({}), {
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

    test("a resolver which fails is an AuthResolverError, when nothing aborts", async () => {
        const failure = new Error("vault is sealed");
        const { db } = await connect(server({}), {
            resolve: () => {
                throw failure;
            },
            when: "request",
        });
        const controller = new AbortController();

        const error = await rejection(db.query("RETURN 1").signal(controller.signal));

        expect(error).toBeInstanceOf(AuthResolverError);
        expect(error.cause).toBe(failure);
    });

    test("a signal which has aborted already does not ask for a credential", async () => {
        let calls = 0;
        const { db } = await connect(server({}), {
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

    test("what was being resolved when the request was abandoned is kept for the next", async () => {
        const gate = deferred<string>();
        let calls = 0;
        const { db, mock } = await connect(server({}), {
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
        await flush();

        await db.query("RETURN 2");

        // Not resolved again, and not resolved to something which was left half done
        expect(calls).toBe(1);
        expect(bearerOf(queries(mock.calls)[0])).toBe(token);
    });

    test("a request which is abandoned does not abandon the resolution it shares with another", async () => {
        const gate = deferred<string>();
        let calls = 0;
        const { db, mock } = await connect(server({}), {
            resolve: () => {
                calls++;
                return gate.promise;
            },
            when: "request",
            cache: "until-expiry",
        });
        const controller = new AbortController();
        const abandoned = rejection(db.query("RETURN 1").signal(controller.signal));
        const waiting = db.query("RETURN 2").collect();

        await flush();
        controller.abort(new Error("client went away"));
        await abandoned;

        const token = createJwtExpiringIn(3600);
        gate.resolve(token);
        await waiting;

        expect(calls).toBe(1);
        expect(queries(mock.calls)).toHaveLength(1);
        expect(bearerOf(queries(mock.calls)[0])).toBe(token);
    });

    test("an abandoned request does not stop the one which follows it from resolving by itself", async () => {
        const gates = [deferred<string>(), deferred<string>()];
        let calls = 0;
        const { db, mock } = await connect(server({}), {
            resolve: () => gates[calls++].promise,
            when: "request",
        });
        const controller = new AbortController();
        const abandoned = rejection(db.query("RETURN 1").signal(controller.signal));

        await flush();
        controller.abort(new Error("client went away"));
        await abandoned;

        const next = db.query("RETURN 2").collect();

        gates[1].resolve("for-the-second");
        await next;
        gates[0].resolve("for-the-first");

        expect(queries(mock.calls).map(bearerOf)).toEqual(["for-the-second"]);
    });

    describe("the replay of a request which the server refused", () => {
        test("is abandoned while a new credential is resolved, which is left to finish", async () => {
            const stale = createJwtExpiringIn(3600, "stale");
            const gate = deferred<string>();
            let calls = 0;
            const { db, mock } = await connect(server({ accept: (token) => token !== stale }), {
                resolve: () => (++calls === 1 ? stale : gate.promise),
                when: "request",
            });
            const controller = new AbortController();
            const reason = new Error("client went away");
            const call = rejection(db.query("RETURN 1").signal(controller.signal));

            await until(() => calls === 2);
            controller.abort(reason);

            expect(await call).toBe(reason);

            gate.resolve(createJwtExpiringIn(3600, "fresh"));
            await flush();

            // The request was sent once, with what was refused, and is not sent again
            expect(queries(mock.calls)).toHaveLength(1);
        });

        test("is abandoned while it is in flight", async () => {
            const stale = createJwtExpiringIn(3600, "stale");
            const fresh = createJwtExpiringIn(3600, "fresh");
            let calls = 0;
            const { db, mock } = await connect(
                (request) => {
                    if (request.rpc?.method !== "query") return { result: null };
                    return bearerOf(request) === stale
                        ? { status: 401 }
                        : new Promise<never>(() => {});
                },
                { resolve: () => (++calls === 1 ? stale : fresh), when: "request" },
            );
            const controller = new AbortController();
            const reason = new Error("client went away");
            const call = rejection(db.query("CREATE thing:one").signal(controller.signal));

            await until(() => queries(mock.calls).length === 2);
            controller.abort(reason);

            expect(await call).toBe(reason);
            expect(queries(mock.calls).map(bearerOf)).toEqual([stale, fresh]);
        });

        test("is held to the request timeout", async () => {
            const stale = createJwtExpiringIn(3600, "stale");
            const { db } = await connect(
                (request) =>
                    request.rpc?.method !== "query"
                        ? { result: null }
                        : bearerOf(request) === stale
                          ? { status: 401 }
                          : new Promise<never>(() => {}),
                {
                    resolve: () => createJwtExpiringIn(3600, `t${Math.random()}`),
                    when: "request",
                },
            );

            // The first token is told apart by the server, which refuses what it does not know
            const error = await rejection(db.query("RETURN 1").requestTimeout(25));

            expect(error.name).toBe("TimeoutError");
        });
    });

    describe("timers", () => {
        let clock: FakeClock | undefined;
        const nativeTimeout = AbortSignal.timeout;

        afterEach(() => {
            clock?.uninstall();
            clock = undefined;
            AbortSignal.timeout = nativeTimeout;
        });

        /** What runtimes without `AbortSignal.timeout` get, which has a timer of its own to let go of */
        async function withoutNativeTimeouts() {
            AbortSignal.timeout = undefined as never;

            const gate = deferred<string>();
            const connected = await connect(server({}), {
                resolve: () => gate.promise,
                when: "request",
            });

            clock = new FakeClock(new Date("2030-01-01T00:00:00Z")).install();

            return { ...connected, gate };
        }

        test("none are left by a request which is abandoned while its credential is resolved", async () => {
            const { db, gate } = await withoutNativeTimeouts();
            const controller = new AbortController();
            const call = rejection(
                db.query("RETURN 1").requestTimeout(30_000).signal(controller.signal),
            );

            await flush();
            expect(clock?.timers).toBe(1);

            controller.abort(new Error("client went away"));
            await call;

            expect(clock?.timers).toBe(0);
            gate.resolve("token");
        });

        test("none are left by a request which times out while its credential is resolved", async () => {
            const { db, gate } = await withoutNativeTimeouts();
            const call = rejection(db.query("RETURN 1").requestTimeout(30_000));

            await flush();
            await clock?.advance(30_000, flush);

            expect((await call).name).toBe("TimeoutError");
            expect(clock?.timers).toBe(0);
            gate.resolve("token");
        });

        test("none are left by a request which completes", async () => {
            const { db, gate } = await withoutNativeTimeouts();
            const call = db.query("RETURN 1").requestTimeout(30_000).collect();

            await flush();
            gate.resolve("token");
            await call;

            expect(clock?.timers).toBe(0);
        });
    });
});
