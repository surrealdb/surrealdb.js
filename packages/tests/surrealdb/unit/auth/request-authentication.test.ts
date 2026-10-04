import { afterEach, describe, expect, setSystemTime, spyOn, test } from "bun:test";
import {
    AuthenticationError,
    AuthResolverError,
    HttpConnectionError,
    NotAllowedError,
    Surreal,
    SurrealError,
} from "../../../../sdk/src";
import { fetchSurreal } from "../../../../sdk/src/internal/http";
import {
    clients,
    closeClients,
    connect,
    createFetchHarness,
    dump,
    ENDPOINT,
    queries,
    rejection,
    server,
    signins,
} from "../__helpers__/mock-client";
import {
    bearerOf,
    createJwtExpiringIn,
    createMockFetch,
    deferred,
    type MockRequest,
    queryResult,
} from "../__helpers__/mock-fetch";

afterEach(async () => {
    setSystemTime();
    await closeClients();
});

describe("authentication configuration", () => {
    async function rejects(authentication: unknown) {
        const mock = createMockFetch(server({}));
        const db = new Surreal({ fetchImpl: mock.fetchImpl });

        clients.push(db);

        const error = await rejection(
            db.connect(ENDPOINT, {
                namespace: "ns",
                database: "db",
                authentication: authentication as never,
            }),
        );

        expect(error).toBeInstanceOf(SurrealError);
        expect(mock.requests).toHaveLength(0);
    }

    test("a resolver must have a function", async () => {
        await rejects({ resolve: "token", when: "request" });
    });

    test("when must be connect or request", async () => {
        await rejects({ resolve: () => null, when: "sometimes" });
    });

    test("a cache policy must be one that can be honoured", async () => {
        await rejects({ resolve: () => null, when: "request", cache: "forever" });
        await rejects({ resolve: () => null, when: "request", cache: { ttl: 0 } });
    });

    test("a resolver with when connect behaves like a function", async () => {
        let calls = 0;
        const { db } = await connect(server({ tokens: ["a"] }), {
            resolve: () => {
                calls++;
                return { access: "user", variables: { id: 1 } };
            },
            when: "connect",
        });

        await db.query("RETURN 1");
        await db.query("RETURN 2");

        expect(calls).toBe(1);
    });
});

describe("per request resolution", () => {
    test("nothing is resolved until a request needs it", async () => {
        let calls = 0;
        const { db, mock } = await connect(server({}), {
            resolve: () => {
                calls++;
                return "t";
            },
            when: "request",
        });

        expect(calls).toBe(0);
        expect(mock.calls).toHaveLength(0);

        await db.query("RETURN 1");

        expect(calls).toBe(1);
    });

    test("the token is the authorization of the request, and of nothing else", async () => {
        const token = createJwtExpiringIn(3600);
        const { db, mock } = await connect(server({}), { resolve: () => token, when: "request" });

        await db.query("RETURN 1");

        const [request] = queries(mock.calls);

        expect(bearerOf(request)).toBe(token);
        expect(request.headers["Surreal-NS"]).toBe("ns");
        expect(request.headers["Surreal-DB"]).toBe("db");
        expect(dump(request.rpc)).not.toContain(token);
    });

    test("the version request does not need credentials", async () => {
        const { mock } = await connect(server({}), {
            resolve: () => {
                throw new Error("must not be asked");
            },
            when: "request",
        });

        expect(mock.requests.map((r) => r.rpc?.method)).toEqual(["version"]);
        expect(bearerOf(mock.requests[0])).toBeUndefined();
    });

    test("the session is not authenticated by the resolved token", async () => {
        const token = createJwtExpiringIn(3600);
        const { db } = await connect(server({}), { resolve: () => token, when: "request" });
        let events = 0;

        db.subscribe("auth", () => events++);
        await db.query("RETURN 1");

        expect(db.accessToken).toBeUndefined();
        expect(events).toBe(0);
    });

    test("no renewal is scheduled", async () => {
        const spy = spyOn(globalThis, "setTimeout");

        try {
            const { db } = await connect(server({}), {
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

    test("a token is reused until shortly before it expires", async () => {
        setSystemTime(new Date("2030-01-01T00:00:00Z"));

        let calls = 0;
        const { db, mock } = await connect(
            server({}),
            {
                resolve: () => createJwtExpiringIn(300, `token-${++calls}`),
                when: "request",
                cache: "until-expiry",
            },
            { expiryMargin: 60 },
        );

        await db.query("RETURN 1");
        await db.query("RETURN 2");
        expect(calls).toBe(1);

        // 61 seconds are left on the token
        setSystemTime(new Date("2030-01-01T00:03:59Z"));
        await db.query("RETURN 3");
        expect(calls).toBe(1);

        // 59 seconds are left, which is within the margin
        setSystemTime(new Date("2030-01-01T00:04:01Z"));
        await db.query("RETURN 4");
        expect(calls).toBe(2);

        const tokens = queries(mock.calls).map(bearerOf);
        expect(tokens[0]).toBe(tokens[1]);
        expect(tokens[2]).toBe(tokens[1]);
        expect(tokens[3]).not.toBe(tokens[2]);
    });

    test("until-expiry is the default policy", async () => {
        let calls = 0;
        const { db } = await connect(server({}), {
            resolve: () => createJwtExpiringIn(3600, `token-${++calls}`),
            when: "request",
        });

        await db.query("RETURN 1");
        await db.query("RETURN 2");

        expect(calls).toBe(1);
    });

    test("concurrent requests share one resolution", async () => {
        const gate = deferred<string>();
        let calls = 0;
        const { db, mock } = await connect(server({}), {
            resolve: () => {
                calls++;
                return gate.promise;
            },
            when: "request",
        });

        const requests = [1, 2, 3, 4, 5].map((n) => db.query(`RETURN ${n}`).collect());

        await Bun.sleep(5);
        expect(calls).toBe(1);
        expect(mock.calls).toHaveLength(0);

        const token = createJwtExpiringIn(3600);
        gate.resolve(token);
        await Promise.all(requests);

        expect(calls).toBe(1);
        expect(queries(mock.calls).map(bearerOf)).toEqual(Array(5).fill(token));
    });

    test("a token without an expiry is resolved for every request", async () => {
        let calls = 0;
        const { db, mock } = await connect(server({}), {
            resolve: () => `opaque-${++calls}`,
            when: "request",
        });

        await db.query("RETURN 1");
        await db.query("RETURN 2");
        await db.query("RETURN 3");

        expect(calls).toBe(3);
        expect(queries(mock.calls).map(bearerOf)).toEqual(["opaque-1", "opaque-2", "opaque-3"]);
    });

    test("a ttl bounds the reuse of a token without an expiry", async () => {
        setSystemTime(new Date("2030-01-01T00:00:00Z"));

        let calls = 0;
        const { db } = await connect(server({}), {
            resolve: () => `opaque-${++calls}`,
            when: "request",
            cache: { ttl: 30 },
        });

        await db.query("RETURN 1");
        setSystemTime(new Date("2030-01-01T00:00:29Z"));
        await db.query("RETURN 2");
        expect(calls).toBe(1);

        setSystemTime(new Date("2030-01-01T00:00:31Z"));
        await db.query("RETURN 3");
        expect(calls).toBe(2);
    });

    test("the policy none evaluates the resolver for every request, and shares nothing", async () => {
        const gates = [deferred<string>(), deferred<string>()];
        let calls = 0;
        const { db, mock } = await connect(server({}), {
            resolve: () => gates[calls++].promise,
            when: "request",
            cache: "none",
        });

        const first = db.query("RETURN 1").collect();
        const second = db.query("RETURN 2").collect();

        await Bun.sleep(5);
        expect(calls).toBe(2);

        // Each request is presented with what was resolved for it, and for it alone
        gates[1].resolve("for-the-second");
        gates[0].resolve("for-the-first");
        await Promise.all([first, second]);

        const byQuery = new Map(
            queries(mock.calls).map((r) => [r.rpc?.params?.[0] as string, bearerOf(r)]),
        );

        expect(byQuery.get("RETURN 1")).toBe("for-the-first");
        expect(byQuery.get("RETURN 2")).toBe("for-the-second");
    });

    test("details returned by the resolver are exchanged for a token once, and reused", async () => {
        const token = createJwtExpiringIn(3600);
        let calls = 0;
        const { db, mock } = await connect(server({ tokens: [token] }), {
            resolve: () => {
                calls++;
                return { access: "user", variables: { id: 7 } };
            },
            when: "request",
        });

        await db.query("RETURN 1");
        await db.query("RETURN 2");
        await db.query("RETURN 3");

        expect(calls).toBe(1);
        expect(signins(mock.calls)).toHaveLength(1);
        expect(signins(mock.calls)[0].rpc?.params?.[0]).toEqual({
            id: 7,
            ac: "user",
            ns: "ns",
            db: "db",
        });

        // The sign in is anonymous, and the requests which follow carry its token
        expect(bearerOf(signins(mock.calls)[0])).toBeUndefined();
        expect(queries(mock.calls).map(bearerOf)).toEqual([token, token, token]);
    });

    test("the resolver receives the session", async () => {
        const seen: unknown[] = [];
        const { db } = await connect(server({}), {
            resolve: (session) => {
                seen.push(session);
                return "t";
            },
            when: "request",
        });

        await db.query("RETURN 1");

        expect(seen).toEqual([undefined]);
    });

    test("a null result sends the request without credentials", async () => {
        const { db, mock } = await connect(server({}), { resolve: () => null, when: "request" });

        await db.query("RETURN 1");

        expect(bearerOf(queries(mock.calls)[0])).toBeUndefined();
    });

    test("signing in takes over from the resolver", async () => {
        let calls = 0;
        const { db, mock } = await connect(server({ tokens: ["manual"] }), {
            resolve: () => {
                calls++;
                return "from-resolver";
            },
            when: "request",
        });

        await db.signin({ username: "tobie", password: "x" });
        await db.query("RETURN 1");

        expect(calls).toBe(0);
        expect(bearerOf(queries(mock.calls)[0])).toBe("manual");
    });

    test("invalidating discards the credential which was resolved", async () => {
        let calls = 0;
        const { db } = await connect(server({}), {
            resolve: () => createJwtExpiringIn(3600, `token-${++calls}`),
            when: "request",
        });

        await db.query("RETURN 1");
        await db.invalidate();
        await db.query("RETURN 2");

        expect(calls).toBe(2);
    });

    test("export and import carry the resolved token to the connection and nowhere else", async () => {
        const token = createJwtExpiringIn(3600);
        const { db, mock } = await connect(server({}), { resolve: () => token, when: "request" });

        await db.import("DEFINE TABLE person;");

        const request = mock.calls.find((r) => r.url.endsWith("/import"));

        expect(request).toBeDefined();
        expect(new URL(request?.url ?? "").origin).toBe(ENDPOINT);
        expect(bearerOf(request as MockRequest)).toBe(token);
    });

    test("requests which carry a resolved token never follow redirects", async () => {
        const token = createJwtExpiringIn(3600);
        const { db, mock } = await connect(server({}), { resolve: () => token, when: "request" });

        await db.query("RETURN 1");

        expect(queries(mock.calls)[0].init.redirect).toBe("manual");
    });

    test("requests with a token of the session are sent as before", async () => {
        const { db, mock } = await connect(server({}), () => "session-token");

        await db.query("RETURN 1");

        expect(queries(mock.calls)[0].init.redirect).toBeUndefined();
        expect(bearerOf(queries(mock.calls)[0])).toBe("session-token");
    });
});

describe("a resolver which fails", () => {
    test("rejects the request with a typed error and nothing is sent", async () => {
        const failure = new Error("vault is sealed");
        const { db, mock } = await connect(server({}), {
            resolve: () => {
                throw failure;
            },
            when: "request",
        });

        const error = await rejection(db.query("RETURN 1"));

        expect(error).toBeInstanceOf(AuthResolverError);
        expect(error).toBeInstanceOf(AuthenticationError);
        expect(error.cause).toBe(failure);
        expect(error.message).not.toContain("vault");
        expect(mock.calls).toHaveLength(0);
    });

    test("never falls back to anonymous or to an earlier credential", async () => {
        let fail = false;
        const { db, mock } = await connect(server({}), {
            resolve: () => {
                if (fail) throw new Error("down");
                return "opaque";
            },
            when: "request",
        });

        await db.query("RETURN 1");
        fail = true;

        await expect(db.query("RETURN 2").collect()).rejects.toBeInstanceOf(AuthResolverError);
        expect(queries(mock.calls)).toHaveLength(1);
    });

    test("rejects asynchronously too, and is not remembered", async () => {
        let calls = 0;
        const { db } = await connect(server({}), {
            resolve: async () => {
                if (++calls === 1) throw new Error("timeout");
                return createJwtExpiringIn(3600);
            },
            when: "request",
        });

        await expect(db.query("RETURN 1").collect()).rejects.toBeInstanceOf(AuthResolverError);
        await expect(db.query("RETURN 2").collect()).resolves.toBeDefined();
        expect(calls).toBe(2);
    });

    test("concurrent requests which waited for it all fail", async () => {
        const gate = deferred<string>();
        const { db, mock } = await connect(server({}), {
            resolve: () => gate.promise,
            when: "request",
        });

        const requests = [db.query("RETURN 1").collect(), db.query("RETURN 2").collect()];
        const settled = Promise.allSettled(requests);

        gate.reject(new Error("nope"));

        const results = await settled;

        expect(results.map((r) => r.status)).toEqual(["rejected", "rejected"]);
        expect(mock.calls).toHaveLength(0);
    });

    test("returning something unusable is a typed error which does not repeat it", async () => {
        const { db, mock } = await connect(server({}), {
            resolve: () => 987654321 as never,
            when: "request",
        });

        const error = await rejection(db.query("RETURN 1"));

        expect(error).toBeInstanceOf(AuthResolverError);
        expect(dump(error.message)).not.toContain("987654321");
        expect(dump((error.cause as Error | undefined)?.message)).not.toContain("987654321");
        expect(mock.calls).toHaveLength(0);
    });

    test("a failing exchange of details for a token fails the request", async () => {
        const { db, mock } = await connect(
            (request) =>
                request.rpc?.method === "signin"
                    ? {
                          error: {
                              code: -32000,
                              message: "There was a problem with authentication",
                              kind: "NotAllowed",
                              details: { kind: "Auth", details: { kind: "InvalidAuth" } },
                          },
                      }
                    : queryResult(1),
            { resolve: () => ({ access: "user", variables: { id: 1 } }), when: "request" },
        );

        const error = await rejection(db.query("RETURN 1"));

        expect(error).toBeInstanceOf(NotAllowedError);
        expect(queries(mock.calls)).toHaveLength(0);
    });
});

describe("a token which the server refuses", () => {
    test("is replaced and the request is sent again, once", async () => {
        const first = createJwtExpiringIn(3600, "first");
        const second = createJwtExpiringIn(3600, "second");
        const tokens = [first, second];
        let revoked = false;
        let calls = 0;

        const { db, mock } = await connect(
            server({ accept: (token) => !(revoked && token === first) }),
            {
                resolve: () => tokens[calls++],
                when: "request",
            },
        );

        await db.query("RETURN 1");
        revoked = true;
        await db.query("RETURN 2");

        expect(calls).toBe(2);
        expect(queries(mock.calls).map(bearerOf)).toEqual([first, first, second]);
    });

    test("is replaced for requests which write as well, as a refusal means nothing ran", async () => {
        const first = createJwtExpiringIn(3600, "first");
        const second = createJwtExpiringIn(3600, "second");
        const tokens = [first, second];
        let calls = 0;

        const { db, mock } = await connect(server({ accept: (token) => token === second }), {
            resolve: () => tokens[calls++],
            when: "request",
        });

        await db.query("CREATE person:tobie");

        expect(queries(mock.calls).map(bearerOf)).toEqual([first, second]);
    });

    test("is not sent a third time when the replacement is refused as well", async () => {
        let calls = 0;
        const { db, mock } = await connect(server({ accept: () => false }), {
            resolve: () => createJwtExpiringIn(3600, `token-${++calls}`),
            when: "request",
        });

        const error = await rejection(db.query("RETURN 1"));

        expect(error).toBeInstanceOf(HttpConnectionError);
        expect(error.status).toBe(401);
        expect(queries(mock.calls)).toHaveLength(2);
        expect(calls).toBe(2);
    });

    test("is not replayed when the resolver has nothing new", async () => {
        const token = createJwtExpiringIn(3600, "same");
        const { db, mock } = await connect(server({ accept: () => false }), {
            resolve: () => token,
            when: "request",
            cache: "none",
        });

        const error = await rejection(db.query("RETURN 1"));

        expect(error).toBeInstanceOf(HttpConnectionError);
        expect(queries(mock.calls)).toHaveLength(1);
    });

    test("concurrent requests which are refused together resolve once more between them", async () => {
        const stale = createJwtExpiringIn(3600, "stale");
        const fresh = createJwtExpiringIn(3600, "fresh");
        const gate = deferred<string>();
        let calls = 0;
        let revoked = false;

        const { db, mock } = await connect(
            server({ accept: (token) => !(revoked && token === stale) }),
            {
                resolve: () => {
                    calls++;
                    return calls === 1 ? stale : gate.promise;
                },
                when: "request",
            },
        );

        await db.query("RETURN 0");
        revoked = true;

        const requests = [1, 2, 3].map((n) => db.query(`RETURN ${n}`).collect());

        await Bun.sleep(10);
        gate.resolve(fresh);
        await Promise.all(requests);

        expect(calls).toBe(2);
        expect(queries(mock.calls).filter((r) => bearerOf(r) === fresh)).toHaveLength(3);
    });

    test("an error reported inside a successful response is never replayed", async () => {
        let calls = 0;
        const { db, mock } = await connect(
            (request) =>
                request.rpc?.method === "query"
                    ? {
                          error: {
                              code: -32002,
                              message: "The token has expired",
                              kind: "NotAllowed",
                              details: { kind: "Auth", details: { kind: "TokenExpired" } },
                          },
                      }
                    : queryResult(1),
            { resolve: () => createJwtExpiringIn(3600, `token-${++calls}`), when: "request" },
        );

        const error = await rejection(db.query("CREATE person:tobie"));

        // The statements of the request may have run, so the request cannot be sent again
        expect(error).toBeInstanceOf(NotAllowedError);
        expect(error.isTokenExpired).toBeTrue();
        expect(queries(mock.calls)).toHaveLength(1);
        expect(calls).toBe(1);
    });

    test("a request whose body was streamed out is not replayed", async () => {
        let calls = 0;
        const { db, mock } = await connect(server({ accept: () => false }), {
            resolve: () => createJwtExpiringIn(3600, `token-${++calls}`),
            when: "request",
        });

        const stream = new ReadableStream({
            start(controller) {
                controller.enqueue(new TextEncoder().encode("DEFINE TABLE person;"));
                controller.close();
            },
        });

        const error = await rejection(db.import(stream));

        expect(error).toBeInstanceOf(HttpConnectionError);
        expect(mock.calls.filter((r) => r.url.endsWith("/import"))).toHaveLength(1);
        expect(calls).toBe(1);
    });

    test("is not replayed for a session token which was not resolved", async () => {
        const { db, mock } = await connect(server({ accept: () => false }), () => "session-token");

        const error = await rejection(db.query("RETURN 1"));

        expect(error).toBeInstanceOf(HttpConnectionError);
        expect(queries(mock.calls)).toHaveLength(1);
    });

    test("a resolver which fails while replacing it fails the request with the typed error", async () => {
        let calls = 0;
        const { db, mock } = await connect(server({ accept: () => false }), {
            resolve: () => {
                if (++calls > 1) throw new Error("down");
                return createJwtExpiringIn(3600);
            },
            when: "request",
        });

        const error = await rejection(db.query("RETURN 1"));

        expect(error).toBeInstanceOf(AuthResolverError);
        expect(queries(mock.calls)).toHaveLength(1);
    });
});

describe("request credentials stay with the connection", () => {
    const { fetched, context, session, state } = createFetchHarness();

    test("a resolved token is not sent to another origin", async () => {
        fetched.length = 0;
        let asked = 0;

        const result = fetchSurreal(
            context,
            state({
                token: async () => {
                    asked++;
                    return "secret";
                },
            }),
            session,
            { url: new URL("https://elsewhere.test/rpc"), body: { x: 1 } },
        );

        await expect(result).rejects.toBeInstanceOf(SurrealError);
        expect(fetched).toEqual([]);
        expect(asked).toBe(0);
    });
});
