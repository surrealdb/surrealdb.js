import { afterEach, describe, expect, setSystemTime, test } from "bun:test";
import {
    AuthenticationError,
    applyDiagnostics,
    createRemoteEngines,
    type Diagnostic,
    Features,
    HttpConnectionError,
    HttpEngine,
    RecordId,
    type Surreal,
    SurrealError,
    Table,
    UnsupportedFeatureError,
} from "../../../../sdk/src";
import { fetchSurreal } from "../../../../sdk/src/internal/http";
import {
    closeClients,
    connect,
    createFetchHarness,
    dump,
    queries,
    rejection,
    server,
    signins,
} from "../__helpers__/mock-client";
import { bearerOf, createJwtExpiringIn } from "../__helpers__/mock-fetch";
import {
    closeSessionClients,
    connect as sessionConnect,
    serve as sessionServe,
} from "../__helpers__/session-engine";

afterEach(async () => {
    setSystemTime();
    await closeClients();
    await closeSessionClients();
});

describe("a credential for a single call stays with the connection", () => {
    const { fetched, context, session, state } = createFetchHarness();

    test("a token for a single call is not sent to another origin", async () => {
        fetched.length = 0;

        const result = fetchSurreal(context, state(), session, {
            url: new URL("http://mock.test:9999/rpc"),
            body: { x: 1 },
            token: "secret",
        });

        await expect(result).rejects.toBeInstanceOf(SurrealError);
        expect(fetched).toEqual([]);
    });

    test("the HTTP origin of a WebSocket connection is the same origin", async () => {
        fetched.length = 0;

        await fetchSurreal(context, state(), session, {
            url: new URL("http://mock.test:8000/import"),
            body: { x: 1 },
            token: "secret",
        });

        expect(fetched).toEqual(["http://mock.test:8000/import"]);
    });
});

describe("a call made as someone else", () => {
    test("presents the token for that call only", async () => {
        const { db, mock } = await connect(server({}), () => "session-token");

        await db.query("RETURN 1").as("call-token");
        await db.query("RETURN 2");

        const [as, plain] = queries(mock.calls);

        expect(bearerOf(as)).toBe("call-token");
        expect(bearerOf(plain)).toBe("session-token");
        expect(db.accessToken).toBe("session-token");
    });

    test("leaves the namespace and database alone", async () => {
        const { db, mock } = await connect(server({}), undefined);

        await db.query("RETURN 1").as("call-token");

        const [request] = queries(mock.calls);

        expect(request.headers["Surreal-NS"]).toBe("ns");
        expect(request.headers["Surreal-DB"]).toBe("db");
    });

    test("never puts the token in the body of the request", async () => {
        const { db, mock } = await connect(server({}), undefined);

        await db.query("RETURN 1").as("call-token-value");

        expect(dump(queries(mock.calls)[0].rpc)).not.toContain("call-token-value");
    });

    test("exchanges authentication details for a token, for that call only", async () => {
        const { db, mock } = await connect(server({ tokens: ["exchanged"] }), "session-token");
        let events = 0;

        db.subscribe("auth", () => events++);

        await db.query("RETURN 1").as({ access: "user", variables: { id: 5 } });

        const methods = mock.calls.map((r) => r.rpc?.method);

        // The session authenticated when connecting, and the call exchanged its own details
        expect(methods).toEqual(["authenticate", "signin", "query"]);
        expect(signins(mock.calls)[0].rpc?.params?.[0]).toEqual({
            id: 5,
            ac: "user",
            ns: "ns",
            db: "db",
        });
        expect(bearerOf(queries(mock.calls)[0])).toBe("exchanged");

        // The details are exchanged without the credential of the session, which may well be
        // one that the server no longer accepts
        expect(bearerOf(signins(mock.calls)[0])).toBeUndefined();
        expect(db.accessToken).toBe("session-token");
        expect(events).toBe(0);
    });

    test("takes precedence over a resolver, which is not consulted", async () => {
        let calls = 0;
        const { db, mock } = await connect(server({}), {
            resolve: () => {
                calls++;
                return "from-resolver";
            },
            when: "request",
        });

        await db.query("RETURN 1").as("call-token");

        expect(calls).toBe(0);
        expect(bearerOf(queries(mock.calls)[0])).toBe("call-token");
    });

    test("is not replayed when refused, as there is nothing to resolve", async () => {
        const { db, mock } = await connect(server({ accept: () => false }), undefined);

        const error = await rejection(db.query("RETURN 1").as("call-token"));

        expect(error).toBeInstanceOf(HttpConnectionError);
        expect(queries(mock.calls)).toHaveLength(1);
    });

    test("never follows a redirect", async () => {
        const { db, mock } = await connect(server({}), undefined);

        await db.query("RETURN 1").as("call-token");

        expect(queries(mock.calls)[0].init.redirect).toBe("manual");
    });

    test("is refused when the credential is unusable, rather than run as the session", async () => {
        const { db, mock } = await connect(server({}), () => "session-token");

        for (const credential of [undefined, null, "", 0, []]) {
            expect(() => db.query("RETURN 1").as(credential as never)).toThrow(AuthenticationError);
        }

        expect(queries(mock.calls)).toHaveLength(0);
    });

    test("is refused by an engine which cannot present it, and never run as the session", async () => {
        const { db, mock } = await connect(
            server({}),
            () => "session-token",
            {},
            {
                engines: {
                    ...createRemoteEngines(),
                    http: (context) => {
                        const engine = new HttpEngine(context);

                        engine.features.delete(Features.PerRequestAuth);

                        return engine;
                    },
                },
            },
        );

        const error = await rejection(db.query("RETURN 1").as("call-token"));

        expect(error).toBeInstanceOf(UnsupportedFeatureError);
        expect(error.feature).toBe(Features.PerRequestAuth);
        expect(queries(mock.calls)).toHaveLength(0);
    });

    /** An engine which does everything the HTTP engine does, but for running a query as someone else */
    function withoutQueryAs(context: ConstructorParameters<typeof HttpEngine>[0]) {
        const inner = new HttpEngine(context);

        return new Proxy(inner, {
            get(target, property) {
                if (property === "queryAs") return undefined;

                const value = Reflect.get(target, property, target);

                return typeof value === "function" ? value.bind(target) : value;
            },
        });
    }

    test("is refused by an engine which declares support but does not implement it", async () => {
        const { db, mock } = await connect(
            server({}),
            () => "session-token",
            {},
            { engines: { ...createRemoteEngines(), http: withoutQueryAs } },
        );

        const error = await rejection(db.query("RETURN 1").as("call-token"));

        expect(error).toBeInstanceOf(UnsupportedFeatureError);
        expect(queries(mock.calls)).toHaveLength(0);
    });

    test("is refused when something wraps an engine without passing it on", async () => {
        const { db, mock } = await connect(
            server({}),
            () => "session-token",
            {},
            {
                engines: applyDiagnostics(
                    { ...createRemoteEngines(), http: withoutQueryAs },
                    () => {},
                ),
            },
        );

        const error = await rejection(db.select(new Table("thing")).as("call-token"));

        expect(error).toBeInstanceOf(UnsupportedFeatureError);
        expect(queries(mock.calls)).toHaveLength(0);
    });

    const table = new Table("thing");
    const record = new RecordId("thing", 1);
    const builders: [string, (db: Surreal) => PromiseLike<unknown>][] = [
        ["query", (db) => db.query("RETURN 1").as("call-token")],
        ["query().json()", (db) => db.query("RETURN 1").as("call-token").json()],
        ["select", (db) => db.select(table).as("call-token")],
        ["select record", (db) => db.select(record).as("call-token").limit(1)],
        ["create", (db) => db.create(table).as("call-token").content({ a: 1 })],
        ["update", (db) => db.update(record).as("call-token").merge({ a: 1 })],
        ["upsert", (db) => db.upsert(record).as("call-token").merge({ a: 1 })],
        ["delete", (db) => db.delete(record).as("call-token")],
        ["insert", (db) => db.insert(table, { a: 1 }).as("call-token")],
        [
            "relate",
            (db) => db.relate(record, new Table("edge"), new RecordId("thing", 2)).as("call-token"),
        ],
        ["run", (db) => db.run("fn::example").as("call-token")],
        ["auth", (db) => db.auth().as("call-token")],
        ["api", (db) => db.api().get("/example").as("call-token")],
    ];

    for (const [name, build] of builders) {
        test(`is supported by ${name}`, async () => {
            const { db, mock } = await connect(server({}), () => "session-token");

            await build(db);

            const sent = queries(mock.calls);

            expect(sent).toHaveLength(1);
            expect(bearerOf(sent[0])).toBe("call-token");
        });
    }
});

describe("diagnostics", () => {
    test("never report credentials", async () => {
        const events: Diagnostic[] = [];
        const resolved = createJwtExpiringIn(3600, "resolved-secret-claim");
        const { db } = await connect(
            server({ tokens: ["exchanged-token-secret"] }),
            { resolve: () => resolved, when: "request" },
            {},
            { engines: applyDiagnostics(createRemoteEngines(), (event) => events.push(event)) },
        );

        await db.query("RETURN 1");
        await db.query("RETURN 2").as("call-token-secret");
        await db.query("RETURN 3").as({
            access: "user",
            variables: { password: "variables-secret" },
        });

        const observed = dump(events);

        expect(events.length).toBeGreaterThan(0);
        expect(observed).not.toContain(resolved);
        expect(observed).not.toContain("call-token-secret");
        expect(observed).not.toContain("exchanged-token-secret");
        expect(observed).not.toContain("variables-secret");
    });

    test("pass the credential of a call on to the engine", async () => {
        const { db, mock } = await connect(
            server({}),
            undefined,
            {},
            { engines: applyDiagnostics(createRemoteEngines(), () => {}) },
        );

        await db.query("RETURN 1").as("call-token");

        expect(bearerOf(queries(mock.calls)[0])).toBe("call-token");
    });
});

describe("a call made as someone else, on a session", () => {
    test("is refused, rather than run as the session", async () => {
        const { db, engine } = await sessionConnect(sessionServe(), {
            resolve: () => "token",
            when: "request",
        });

        const error = await rejection(db.query("RETURN 1").as("other-token"));

        expect(error).toBeInstanceOf(UnsupportedFeatureError);
        expect(engine.methods()).not.toContain("query");
    });
});
