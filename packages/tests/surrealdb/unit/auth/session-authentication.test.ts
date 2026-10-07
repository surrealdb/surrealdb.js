import { afterEach, describe, expect, setSystemTime, spyOn, test } from "bun:test";
import { AuthResolverError, NotAllowedError, ServerError } from "../../../../sdk/src";
import {
    bearerOf,
    createJwtExpiringIn,
    createMockFetch,
    deferred,
} from "../__helpers__/mock-fetch";
import { closeSessionClients, connect, serve } from "../__helpers__/session-engine";

afterEach(async () => {
    setSystemTime();
    await closeSessionClients();
});

describe("per request authentication of a session", () => {
    test("nothing is resolved or sent until a request needs it", async () => {
        let calls = 0;
        const { engine } = await connect(serve(), {
            resolve: () => {
                calls++;
                return "token";
            },
            when: "request",
        });

        expect(calls).toBe(0);
        expect(engine.methods()).not.toContain("authenticate");
    });

    test("the session is authenticated before the request is sent", async () => {
        const token = createJwtExpiringIn(3600);
        const { db, engine } = await connect(serve(), { resolve: () => token, when: "request" });
        const events: unknown[] = [];

        db.subscribe("auth", (tokens) => events.push(tokens));

        await db.query("RETURN 1");

        expect(engine.methods().filter((m) => m !== "use")).toEqual(["authenticate", "query"]);
        expect(engine.sent.find((r) => r.method === "authenticate")?.params).toEqual([token]);
        expect(db.accessToken).toBe(token);
        expect(events).toEqual([{ access: token, refresh: undefined }]);
    });

    test("a token which is still good is neither resolved nor sent again", async () => {
        let calls = 0;
        const { db, engine } = await connect(serve(), {
            resolve: () => {
                calls++;
                return createJwtExpiringIn(3600);
            },
            when: "request",
            cache: "until-expiry",
        });

        await db.query("RETURN 1");
        await db.query("RETURN 2");
        await db.query("RETURN 3");

        expect(calls).toBe(1);
        expect(engine.methods().filter((m) => m === "authenticate")).toHaveLength(1);
    });

    test("the resolver is asked every time by default, and the server is told only of changes", async () => {
        let current = "opaque-a";
        let calls = 0;
        const { db, engine } = await connect(serve(), {
            resolve: () => {
                calls++;
                return current;
            },
            when: "request",
        });
        const authentications = () => engine.methods().filter((m) => m === "authenticate").length;

        await db.query("RETURN 1");
        await db.query("RETURN 2");

        expect(calls).toBe(2);
        expect(authentications()).toBe(1);

        current = "opaque-b";
        await db.query("RETURN 3");

        expect(calls).toBe(3);
        expect(authentications()).toBe(2);
        expect(db.accessToken).toBe("opaque-b");
    });

    test("authentication details sign the session in, and that is all", async () => {
        const token = createJwtExpiringIn(3600);
        const { db, engine } = await connect(serve({ tokens: [token] }), {
            resolve: () => ({ access: "user", variables: { id: 1 } }),
            when: "request",
            cache: "until-expiry",
        });

        await db.query("RETURN 1");
        await db.query("RETURN 2");

        expect(engine.methods().filter((m) => m !== "use")).toEqual(["signin", "query", "query"]);
        expect(db.accessToken).toBe(token);
    });

    test("concurrent requests wait for one resolution, and run after the session is authenticated", async () => {
        const gate = deferred<null>();
        const order: string[] = [];
        let resolved = 0;

        const { db, engine } = await connect(
            (request) => {
                if (request.method === "authenticate") {
                    order.push("authenticate");
                    return gate.promise;
                }

                if (request.method === "query") order.push("query");

                return serve()(request);
            },
            {
                resolve: () => {
                    resolved++;
                    return "token";
                },
                when: "request",
                cache: "until-expiry",
            },
        );

        const requests = [1, 2, 3].map((n) => db.query(`RETURN ${n}`).collect());

        await Bun.sleep(10);
        expect(order).toEqual(["authenticate"]);

        gate.resolve(null);
        await Promise.all(requests);

        expect(resolved).toBe(1);
        expect(order).toEqual(["authenticate", "query", "query", "query"]);
        expect(engine.methods().filter((m) => m === "authenticate")).toHaveLength(1);
    });

    test("what concurrent requests resolved is applied one after the other, by default", async () => {
        const tokens = ["opaque-a", "opaque-b", "opaque-c"];
        const gates = [deferred<null>(), deferred<null>(), deferred<null>()];
        const applied: string[] = [];
        let resolved = 0;
        let running = 0;
        let overlapped = false;

        const { db } = await connect(
            async (request) => {
                if (request.method === "authenticate") {
                    running++;
                    overlapped ||= running > 1;
                    applied.push(request.params?.[0] as string);

                    await gates[applied.length - 1].promise;
                    running--;

                    return null;
                }

                return serve()(request);
            },
            {
                resolve: () => tokens[resolved++],
                when: "request",
            },
        );

        const requests = [1, 2, 3].map((n) => db.query(`RETURN ${n}`).collect());

        await Bun.sleep(10);

        // The session holds one identity, and it is what the last of them applied, so they do
        // not race: nothing is applied until what was applied before has been
        expect(applied).toEqual(["opaque-a"]);

        gates[0].resolve(null);
        await Bun.sleep(10);
        expect(applied).toEqual(["opaque-a", "opaque-b"]);

        gates[1].resolve(null);
        await Bun.sleep(10);
        gates[2].resolve(null);
        await Promise.all(requests);

        expect(applied).toEqual(tokens);
        expect(overlapped).toBeFalse();
        expect(db.accessToken).toBe("opaque-c");
    });

    test("a resolver which fails rejects the request, which is never sent", async () => {
        const { db, engine } = await connect(serve(), {
            resolve: () => {
                throw new Error("vault is sealed");
            },
            when: "request",
        });

        const error = await db
            .query("RETURN 1")
            .collect()
            .catch((e) => e);

        expect(error).toBeInstanceOf(AuthResolverError);
        expect(engine.methods()).not.toContain("query");
        expect(engine.methods()).not.toContain("authenticate");
        expect(db.accessToken).toBeUndefined();
    });

    test("a session which holds a credential keeps it when the next one cannot be resolved", async () => {
        let failing = false;
        const { db, engine } = await connect(serve(), {
            resolve: () => {
                if (failing) throw new Error("down");
                return "opaque";
            },
            when: "request",
        });

        await db.query("RETURN 1");
        failing = true;

        await expect(db.query("RETURN 2").collect()).rejects.toBeInstanceOf(AuthResolverError);

        // What the server holds, and what is known of it, agree
        expect(db.accessToken).toBe("opaque");
        expect(engine.methods().filter((m) => m === "query")).toHaveLength(1);
        expect(engine.methods()).not.toContain("invalidate");
    });

    test("a token which the server refuses is neither adopted nor followed by the request", async () => {
        let current = "good";
        const { db, engine } = await connect(
            serve({
                authenticate: (request) => {
                    if (request.params?.[0] === "bad") {
                        throw new NotAllowedError({
                            kind: "NotAllowed",
                            message: "There was a problem with authentication",
                            details: { kind: "Auth", details: { kind: "InvalidAuth" } },
                        });
                    }

                    return null;
                },
            }),
            { resolve: () => current, when: "request", cache: "none" },
        );

        await db.query("RETURN 1");

        current = "bad";

        const error = await db
            .query("RETURN 2")
            .collect()
            .catch((e) => e);

        expect(error).toBeInstanceOf(ServerError);
        expect(db.accessToken).toBe("good");
        expect(engine.methods().filter((m) => m === "query")).toHaveLength(1);

        // And the failure was not remembered
        current = "good";
        await db.query("RETURN 3");
        expect(engine.methods().filter((m) => m === "query")).toHaveLength(2);
    });

    test("a null result invalidates a session which was authenticated", async () => {
        let current: string | null = "opaque";
        const { db, engine } = await connect(serve(), {
            resolve: () => current,
            when: "request",
            cache: "none",
        });

        await db.query("RETURN 1");
        current = null;
        await db.query("RETURN 2");

        expect(engine.methods()).toContain("invalidate");
        expect(db.accessToken).toBeUndefined();
    });

    test("a null result does not touch a session which was never authenticated", async () => {
        const { db, engine } = await connect(serve(), { resolve: () => null, when: "request" });

        await db.query("RETURN 1");

        expect(engine.methods()).not.toContain("invalidate");
        expect(engine.methods()).not.toContain("authenticate");
    });

    test("is resolved again after the connection is re-established", async () => {
        let calls = 0;
        const { db, engine } = await connect(serve(), {
            resolve: () => {
                calls++;
                return createJwtExpiringIn(3600, `token-${calls}`);
            },
            when: "request",
        });
        const events: unknown[] = [];

        await db.query("RETURN 1");
        expect(calls).toBe(1);

        db.subscribe("auth", (tokens) => events.push(tokens));
        engine.reconnect();
        await db.ready;
        await Bun.sleep(10);

        // The server does not know the session any more, and neither does the SDK
        expect(db.accessToken).toBeUndefined();
        expect(events).toEqual([null]);

        await db.query("RETURN 2");

        expect(calls).toBe(2);
        expect(engine.methods().filter((m) => m === "authenticate")).toHaveLength(2);
    });

    test("no renewal is scheduled", async () => {
        const spy = spyOn(globalThis, "setTimeout");

        try {
            const { db } = await connect(serve(), {
                resolve: () => createJwtExpiringIn(3600),
                when: "request",
            });

            await db.query("RETURN 1");

            const delayed = spy.mock.calls.filter(([, ms]) => typeof ms === "number" && ms > 0);
            expect(delayed).toHaveLength(0);
        } finally {
            spy.mockRestore();
        }
    });

    test("signing in takes over from the resolver", async () => {
        let calls = 0;
        const { db } = await connect(serve({ tokens: ["manual"] }), {
            resolve: () => {
                calls++;
                return "from-resolver";
            },
            when: "request",
        });

        await db.signin({ username: "tobie", password: "x" });
        await db.query("RETURN 1");

        expect(calls).toBe(0);
        expect(db.accessToken).toBe("manual");
    });

    test("invalidating discards the credential", async () => {
        let calls = 0;
        const { db, engine } = await connect(serve(), {
            resolve: () => {
                calls++;
                return createJwtExpiringIn(3600, `token-${calls}`);
            },
            when: "request",
        });

        await db.query("RETURN 1");
        await db.invalidate();
        await db.query("RETURN 2");

        expect(calls).toBe(2);
        expect(engine.methods().filter((m) => m === "authenticate")).toHaveLength(2);
    });

    test("an export is made with the credential of the session", async () => {
        const token = createJwtExpiringIn(3600);
        const mock = createMockFetch(() => ({ result: null }));
        const { db, engine } = await connect(
            serve(),
            { resolve: () => token, when: "request" },
            {},
            mock.fetchImpl,
        );

        await db.export();

        const request = mock.requests.find((r) => r.url.endsWith("/export"));

        expect(engine.methods()).toContain("authenticate");
        expect(request).toBeDefined();
        expect(bearerOf(request as never)).toBe(token);
    });
});
