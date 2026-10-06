import { afterEach, describe, expect, test } from "bun:test";
import {
    AuthenticationError,
    AuthResolverError,
    Features,
    HttpConnectionError,
    type Surreal,
    UnsupportedFeatureError,
} from "../../../../sdk/src";
import {
    closeClients,
    connect,
    type Failure,
    rejection,
    signins,
} from "../__helpers__/mock-client";
import {
    bearerOf,
    createJwtExpiringIn,
    createMockFetch,
    deferred,
    type MockHandler,
    type MockRequest,
} from "../__helpers__/mock-fetch";
import {
    closeSessionClients,
    connect as connectSession,
    serve,
} from "../__helpers__/session-engine";

// Import and export are requests like the others as far as credentials go: whatever the connection
// presents with a request, they present, and they are abandoned by their signal at every wait,
// including the wait for a credential which is being resolved or exchanged.

afterEach(async () => {
    await closeClients();
    await closeSessionClients();
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

const isTransfer = (request: MockRequest) => !new URL(request.url).pathname.endsWith("/rpc");

/** The import and export requests which were made, and not the RPC calls around them */
const transfers = (requests: MockRequest[]) => requests.filter(isTransfer);

/**
 * A server which accepts every import and export, unless it is told which tokens it accepts, and
 * hands out a token for authentication details it is asked to sign in.
 */
function serving(accept: (token: string | undefined) => boolean = () => true): MockHandler {
    return (request) => {
        if (request.rpc?.method === "signin") return { result: "exchanged-token" };
        if (isTransfer(request) && !accept(bearerOf(request))) return { status: 401 };

        return { result: "ok" };
    };
}

/** Credentials which are resolved for each request */
const perRequest = (resolve: () => string | Promise<string>) => ({
    resolve,
    when: "request" as const,
});

/** An upload which sends nothing, and notes how it was left */
function upload(log: { cancelled?: unknown } = {}) {
    return {
        log,
        stream: new ReadableStream<Uint8Array>({
            pull: () => new Promise(() => {}),
            cancel(reason) {
                log.cancelled = reason;
            },
        }),
    };
}

/** What every kind of import and export is, as something which can be given an identity and a signal */
type Transfer = PromiseLike<unknown> & {
    as(credential: string | object): Transfer;
    signal(signal: AbortSignal | undefined): Transfer;
    requestTimeout(milliseconds: number): Transfer;
};

type Source = Pick<Surreal, "import" | "export" | "exportModel">;

const kinds: [string, (db: Source) => Transfer][] = [
    ["an export", (db) => db.export() as unknown as Transfer],
    ["a model export", (db) => db.exportModel("model", "1.0.0") as unknown as Transfer],
    ["an import of a string", (db) => db.import("DEFINE TABLE a;") as unknown as Transfer],
    [
        "an import of a blob",
        (db) => db.import(new Blob(["DEFINE TABLE a;"])) as unknown as Transfer,
    ],
    ["an import of a stream", (db) => db.import(upload().stream) as unknown as Transfer],
];

// The kinds whose body can be sent again, as opposed to a stream which has been uploaded
const replayable = kinds.filter(([name]) => !name.includes("stream"));

describe("an import or export, with a credential resolved for each request", () => {
    for (const [name, build] of kinds) {
        test(`${name} presents the credential which is resolved for it`, async () => {
            let resolved = 0;
            const { db, mock } = await connect(
                serving(),
                perRequest(() => `token-${++resolved}`),
            );

            await build(db);
            await build(db);

            expect(transfers(mock.calls).map(bearerOf)).toEqual(["token-1", "token-2"]);
        });

        test(`${name} is abandoned while the credential is being resolved, and sends nothing`, async () => {
            const gate = deferred<string>();
            const { db, mock } = await connect(
                serving(),
                perRequest(() => gate.promise),
            );
            const controller = new AbortController();
            const reason = new Error("client went away");
            const call = rejection(build(db).signal(controller.signal));

            await flush();
            controller.abort(reason);

            expect(await call).toBe(reason);

            // What the resolver comes up with later is not used for a request which is gone
            gate.resolve("late-token");
            await flush();

            expect(transfers(mock.calls)).toHaveLength(0);
        });

        test(`${name} which has a request timeout ends the wait with a TimeoutError`, async () => {
            const { db, mock } = await connect(
                serving(),
                perRequest(() => new Promise<string>(() => {})),
            );

            const error = await rejection(build(db).requestTimeout(25));

            expect(error.name).toBe("TimeoutError");
            expect(transfers(mock.calls)).toHaveLength(0);
        });

        test(`${name} is not cut short by the request timeout of the connection while it waits for the credential`, async () => {
            const { db, mock } = await connect(
                serving(),
                perRequest(async () => {
                    await Bun.sleep(80);
                    return "slow-token";
                }),
                { requestTimeout: 25 },
            );

            await build(db);

            expect(transfers(mock.calls).map(bearerOf)).toEqual(["slow-token"]);
        });

        test(`${name} through a scope is abandoned with the signal of the scope`, async () => {
            const gate = deferred<string>();
            const { db, mock } = await connect(
                serving(),
                perRequest(() => gate.promise),
            );
            const controller = new AbortController();
            const reason = new Error("request went away");
            const call = rejection(build(db.withSignal(controller.signal)));

            await flush();
            controller.abort(reason);

            expect(await call).toBe(reason);
            expect(transfers(mock.calls)).toHaveLength(0);
        });
    }

    test("a stream is let go of with the reason when the wait for its credential is abandoned", async () => {
        const gate = deferred<string>();
        const { db } = await connect(
            serving(),
            perRequest(() => gate.promise),
        );
        const { stream, log } = upload();
        const controller = new AbortController();
        const reason = new Error("client went away");
        const call = rejection(db.import(stream).signal(controller.signal));

        await flush();
        controller.abort(reason);

        expect(await call).toBe(reason);
        expect(log.cancelled).toBe(reason);
    });

    test("a stream is let go of when its credential cannot be resolved", async () => {
        const { db, mock } = await connect(
            serving(),
            perRequest(() => {
                throw new Error("no credential");
            }),
        );
        const { stream, log } = upload();
        const error = await rejection(db.import(stream));

        expect(error).toBeInstanceOf(AuthResolverError);
        expect(log.cancelled).toBe(error);
        expect(transfers(mock.calls)).toHaveLength(0);
    });

    test("a stream which is already abandoned is not touched, and nothing is resolved", async () => {
        let resolved = 0;
        const { db, mock } = await connect(
            serving(),
            perRequest(() => `token-${++resolved}`),
        );
        const { stream, log } = upload();
        const reason = new Error("never started");

        const error = await rejection(db.import(stream).signal(AbortSignal.abort(reason)));

        expect(error).toBe(reason);
        expect(resolved).toBe(0);
        expect(log.cancelled).toBeUndefined();
        expect(transfers(mock.calls)).toHaveLength(0);
    });
});

describe("an import or export which the server refuses for its credential", () => {
    for (const [name, build] of replayable) {
        test(`${name} is sent again with the credential which is resolved after the refusal`, async () => {
            const stale = createJwtExpiringIn(3600, "stale");
            const fresh = createJwtExpiringIn(3600, "fresh");
            let resolved = 0;
            const { db, mock } = await connect(
                serving((token) => token !== stale),
                perRequest(() => (++resolved === 1 ? stale : fresh)),
            );

            await build(db);

            expect(transfers(mock.calls).map(bearerOf)).toEqual([stale, fresh]);
        });
    }

    test("an import of a stream is never sent again, as what was uploaded cannot be", async () => {
        const stale = createJwtExpiringIn(3600, "stale");
        let resolved = 0;
        const { db, mock } = await connect(
            serving((token) => token !== stale),
            perRequest(() => {
                resolved++;
                return stale;
            }),
        );

        const error = await rejection(db.import(upload().stream));

        expect(error).toBeInstanceOf(HttpConnectionError);
        expect(error.status).toBe(401);

        // One request, and no new credential asked for in the hope of sending another
        expect(transfers(mock.calls)).toHaveLength(1);
        expect(resolved).toBe(1);
    });

    test("an import of a stream with a signal is not sent again either", async () => {
        const stale = createJwtExpiringIn(3600, "stale");
        let resolved = 0;
        const { db, mock } = await connect(
            serving((token) => token !== stale),
            perRequest(() => {
                resolved++;
                return stale;
            }),
        );
        const controller = new AbortController();

        const error = await rejection(db.import(upload().stream).signal(controller.signal));

        expect(error.status).toBe(401);
        expect(transfers(mock.calls)).toHaveLength(1);
        expect(resolved).toBe(1);
    });

    test("the wait for the new credential is abandoned with the signal, and nothing is sent again", async () => {
        const stale = createJwtExpiringIn(3600, "stale");
        const gate = deferred<string>();
        let resolved = 0;
        const { db, mock } = await connect(
            serving((token) => token !== stale),
            perRequest(() => (++resolved === 1 ? stale : gate.promise)),
        );
        const controller = new AbortController();
        const reason = new Error("client went away");
        const call = rejection(db.export().signal(controller.signal));

        await until(() => resolved === 2);
        controller.abort(reason);

        expect(await call).toBe(reason);

        gate.resolve(createJwtExpiringIn(3600, "fresh"));
        await flush();

        expect(transfers(mock.calls)).toHaveLength(1);
    });
});

describe(".as() on an import or export", () => {
    for (const [name, build] of kinds) {
        test(`${name} is made as the identity it was asked to be, without the credential of the connection`, async () => {
            let resolved = 0;
            const { db, mock } = await connect(
                serving(),
                perRequest(() => {
                    resolved++;
                    return "session-token";
                }),
            );

            await build(db).as("call-token");

            expect(transfers(mock.calls).map(bearerOf)).toEqual(["call-token"]);
            expect(resolved).toBe(0);
        });

        test(`${name} which the server refuses is not sent again as another identity`, async () => {
            let resolved = 0;
            const { db, mock } = await connect(
                serving((token) => token !== "call-token"),
                perRequest(() => {
                    resolved++;
                    return "session-token";
                }),
            );

            const error = await rejection(build(db).as("call-token"));

            expect(error.status).toBe(401);
            expect(transfers(mock.calls).map(bearerOf)).toEqual(["call-token"]);
            expect(resolved).toBe(0);
        });
    }

    const orders: [string, (t: Transfer, token: string, signal: AbortSignal) => Transfer][] = [
        ["as then signal", (t, token, signal) => t.as(token).signal(signal)],
        ["signal then as", (t, token, signal) => t.signal(signal).as(token)],
        [
            "as, request timeout, signal",
            (t, token, s) => t.as(token).requestTimeout(5_000).signal(s),
        ],
        [
            "request timeout, signal, as",
            (t, token, s) => t.requestTimeout(5_000).signal(s).as(token),
        ],
        [
            "signal, as, request timeout",
            (t, token, s) => t.signal(s).as(token).requestTimeout(5_000),
        ],
    ];

    for (const [name, build] of kinds) {
        for (const [order, compose] of orders) {
            test(`${name}: ${order}`, async () => {
                const { db, mock } = await connect(serving(), undefined);
                const controller = new AbortController();

                await compose(build(db), "call-token", controller.signal);

                const [sent] = transfers(mock.calls);

                expect(transfers(mock.calls)).toHaveLength(1);
                expect(bearerOf(sent)).toBe("call-token");
                expect(sent.init.signal).toBeInstanceOf(AbortSignal);
            });
        }

        test(`${name}: a signal which has aborted already sends nothing, as whoever it is`, async () => {
            const { db, mock } = await connect(serving(), undefined);
            const reason = new Error("never started");

            const error = await rejection(
                build(db).as("call-token").signal(AbortSignal.abort(reason)),
            );

            expect(error).toBe(reason);
            expect(mock.calls).toHaveLength(0);
        });

        test(`${name}: authentication details are exchanged for a token, which is presented`, async () => {
            const { db, mock } = await connect(serving(), undefined);

            await build(db).as({ username: "user", password: "pass" });

            expect(signins(mock.calls)).toHaveLength(1);
            expect(bearerOf(signins(mock.calls)[0])).toBeUndefined();
            expect(transfers(mock.calls).map(bearerOf)).toEqual(["exchanged-token"]);
        });

        test(`${name}: the wait while authentication details are exchanged is abandoned, and nothing is sent after`, async () => {
            const { db, mock } = await connect(
                (request) =>
                    request.rpc?.method === "signin"
                        ? new Promise<never>(() => {})
                        : { result: "ok" },
                undefined,
            );
            const controller = new AbortController();
            const reason = new Error("client went away");
            const call = rejection(
                build(db).as({ username: "user", password: "pass" }).signal(controller.signal),
            );

            await until(() => signins(mock.calls).length === 1);
            controller.abort(reason);

            expect(await call).toBe(reason);
            expect(transfers(mock.calls)).toHaveLength(0);

            // The request of the exchange itself is abandoned, not left to run
            expect(signins(mock.calls)[0].init.signal?.aborted).toBe(true);
        });

        test(`${name}: a credential which cannot be used is refused, rather than ignored`, async () => {
            const { db, mock } = await connect(serving(), undefined);

            expect(() => build(db).as("")).toThrow(AuthenticationError);
            expect(() => build(db).as(null as never)).toThrow(AuthenticationError);
            expect(mock.calls).toHaveLength(0);
        });
    }

    test("through a scope, a signal given to the call is combined with the one of the scope", async () => {
        const { db, mock } = await connect(
            (request) =>
                request.rpc?.method === "signin" ? new Promise<never>(() => {}) : { result: "ok" },
            undefined,
        );
        const scope = new AbortController();
        const call = new AbortController();
        const reason = new Error("request went away");
        const first = rejection(
            db
                .withSignal(scope.signal)
                .export()
                .as({ username: "user", password: "pass" })
                .signal(call.signal),
        );

        await until(() => signins(mock.calls).length === 1);
        scope.abort(reason);

        expect(await first).toBe(reason);
        expect(transfers(mock.calls)).toHaveLength(0);
    });

    test("an import made as someone else on a request scope carries the identity, not the session", async () => {
        const { db, mock } = await connect(
            serving(),
            perRequest(() => "session-token"),
        );
        const controller = new AbortController();

        await db.withSignal(controller.signal).import("DEFINE TABLE a;").as("call-token");
        await db.withSignal(controller.signal).export().as("call-token");
        await db.withSignal(controller.signal).exportModel("model", "1.0.0").as("call-token");

        expect(transfers(mock.calls).map(bearerOf)).toEqual([
            "call-token",
            "call-token",
            "call-token",
        ]);
    });
});

describe("an engine which keeps the credentials in a session", () => {
    /**
     * A connection on such an engine, which can import and export like the WebSocket engine does,
     * and whose imports and exports travel over HTTP, which a server of the test answers.
     */
    async function sessions(resolve: () => string | Promise<string>) {
        const server = createMockFetch(serving());
        const { db, engine } = await connectSession(
            serve(),
            perRequest(resolve),
            {},
            server.fetchImpl,
        );

        engine.features.add(Features.ExportImportRaw);
        engine.features.add(Features.SurrealML);

        return { db, engine, server };
    }

    test("an import or export presents the credential which was applied to the session for it", async () => {
        const { db, engine, server } = await sessions(() => "applied-token");

        await db.export();
        await db.import("DEFINE TABLE a;");
        await db.exportModel("model", "1.0.0");

        expect(engine.methods()).toContain("authenticate");
        expect(transfers(server.calls).map(bearerOf)).toEqual([
            "applied-token",
            "applied-token",
            "applied-token",
        ]);
    });

    for (const [name, build] of kinds) {
        test(`${name} is abandoned while the credential is being applied, and sends nothing`, async () => {
            const gate = deferred<string>();
            const { db, engine, server } = await sessions(() => gate.promise);
            const controller = new AbortController();
            const reason = new Error("client went away");
            const call = rejection(build(db).signal(controller.signal));

            await flush();
            controller.abort(reason);

            expect(await call).toBe(reason);
            expect(engine.methods()).not.toContain("authenticate");

            // What the resolver comes up with later is applied to the session for the requests which
            // follow, and is not what a request which is gone is sent with
            gate.resolve("late-token");
            await flush();

            expect(transfers(server.calls)).toHaveLength(0);
        });

        test(`${name} which is queued behind another for its credential does not begin to resolve one once it is abandoned`, async () => {
            const first = deferred<string>();
            let resolved = 0;
            const { db, engine, server } = await sessions(() =>
                ++resolved === 1 ? first.promise : "applied-token",
            );
            const blocking = db.export();
            const controller = new AbortController();
            const reason = new Error("client went away");

            // The first waits for its credential, and the second is queued behind it
            const waiting = rejection(blocking.signal(AbortSignal.timeout(50)));
            await until(() => resolved === 1);

            const queued = rejection(build(db).signal(controller.signal));
            await flush();
            controller.abort(reason);

            expect(await queued).toBe(reason);
            expect((await waiting).name).toBe("TimeoutError");

            first.resolve("first-token");
            await until(() => engine.methods().includes("authenticate"));
            await flush();

            // Only the first was asked for a credential: the one which is gone never was
            expect(resolved).toBe(1);
            expect(transfers(server.calls)).toHaveLength(0);
        });

        test(`${name} which is made as someone else is refused, rather than made as the session`, async () => {
            const { db, server } = await sessions(() => "applied-token");

            const error: Failure = await rejection(build(db).as("call-token"));

            expect(error).toBeInstanceOf(UnsupportedFeatureError);
            expect(error.feature).toBe(Features.PerRequestAuth);
            expect(server.calls).toHaveLength(0);
        });
    }
});
