import { afterEach, describe, expect, setSystemTime, test } from "bun:test";
import { AuthenticationError, AuthResolverError, Surreal } from "../../../../sdk/src";
import {
    clients,
    closeClients,
    connect,
    ENDPOINT,
    queries,
    rejection,
    server,
    signins,
} from "../__helpers__/mock-client";
import { bearerOf, createJwtExpiringIn, createMockFetch } from "../__helpers__/mock-fetch";
import {
    closeSessionClients,
    connect as connectSession,
    serve as serveSession,
    until,
} from "../__helpers__/session-engine";

afterEach(async () => {
    setSystemTime();
    await closeClients();
    await closeSessionClients();
});

describe("providers returning any authentication", () => {
    test("a callback may return record access details", async () => {
        const { db, mock } = await connect(server({ tokens: ["record-token"] }), () => ({
            access: "user",
            variables: { id: 123, email: "tobie@example.com" },
        }));

        await db.query("RETURN 1");

        const [signin] = signins(mock.calls);

        expect(signin.rpc?.params?.[0]).toEqual({
            id: 123,
            email: "tobie@example.com",
            ac: "user",
            ns: "ns",
            db: "db",
        });

        expect(db.accessToken).toBe("record-token");
        expect(bearerOf(queries(mock.calls)[0])).toBe("record-token");
    });

    test("a static value may be record access details", async () => {
        const { db, mock } = await connect(server({ tokens: ["record-token"] }), {
            access: "user",
            variables: { id: 1 },
        });

        await db.query("RETURN 1");

        expect(signins(mock.calls)).toHaveLength(1);
        expect(bearerOf(queries(mock.calls)[0])).toBe("record-token");
    });

    test("a callback may return a bearer access key", async () => {
        const { db, mock } = await connect(server({ tokens: ["bearer-token"] }), () => ({
            access: "api",
            key: "surreal-bearer-key",
        }));

        await db.query("RETURN 1");

        // The namespace and database are left out of a bearer signin which does not name them
        expect(signins(mock.calls)[0].rpc?.params?.[0]).toEqual({
            ac: "api",
            key: "surreal-bearer-key",
        });
        expect(bearerOf(queries(mock.calls)[0])).toBe("bearer-token");
    });

    test("a callback may return a system user signing in through an access method", async () => {
        const { db, mock } = await connect(server({ tokens: ["system-token"] }), () => ({
            username: "tobie",
            password: "secret",
            access: "staff",
        }));

        await db.query("RETURN 1");

        expect(signins(mock.calls)[0].rpc?.params?.[0]).toEqual({
            user: "tobie",
            pass: "secret",
            ac: "staff",
        });
        expect(bearerOf(queries(mock.calls)[0])).toBe("system-token");
    });

    test("a callback may be asynchronous and returns a token", async () => {
        const token = createJwtExpiringIn(3600);
        const { db, mock } = await connect(server({}), async () => token);

        await db.query("RETURN 1");

        expect(bearerOf(queries(mock.calls)[0])).toBe(token);
        expect(db.accessToken).toBe(token);
    });

    test("the provider is not consulted again for requests", async () => {
        let calls = 0;
        const { db } = await connect(server({ tokens: ["a", "b"] }), () => {
            calls++;
            return { access: "user", variables: { id: 1 } };
        });

        await db.query("RETURN 1");
        await db.query("RETURN 2");
        await db.query("RETURN 3");

        expect(calls).toBe(1);
    });

    test("a provider which throws fails the connection with a typed error", async () => {
        const mock = createMockFetch(server({}));
        const db = new Surreal({ fetchImpl: mock.fetchImpl });
        const failure = new Error("identity provider is down");

        clients.push(db);

        const error = await rejection(
            db.connect(ENDPOINT, {
                namespace: "ns",
                database: "db",
                authentication: () => {
                    throw failure;
                },
            }),
        );

        expect(error).toBeInstanceOf(AuthResolverError);
        expect(error).toBeInstanceOf(AuthenticationError);
        expect(error.cause).toBe(failure);
        expect(error.message).not.toContain("identity provider");
        expect(queries(mock.calls)).toHaveLength(0);
    });

    test("a provider returning something unusable fails the connection", async () => {
        for (const value of [undefined, 42, "", [], true]) {
            const mock = createMockFetch(server({}));
            const db = new Surreal({ fetchImpl: mock.fetchImpl });

            clients.push(db);

            const error = await rejection(
                db.connect(ENDPOINT, {
                    namespace: "ns",
                    database: "db",
                    authentication: () => value as never,
                }),
            );

            expect(error).toBeInstanceOf(AuthResolverError);
            expect(error.cause).toBeInstanceOf(TypeError);
        }
    });

    test("what a provider returned is never repeated in the error", async () => {
        const mock = createMockFetch(server({}));
        const db = new Surreal({ fetchImpl: mock.fetchImpl });

        clients.push(db);

        const error = await rejection(
            db.connect(ENDPOINT, {
                namespace: "ns",
                database: "db",
                authentication: () => 12345678 as never,
            }),
        );

        expect(error.message).not.toContain("12345678");
        expect((error.cause as Error).message).not.toContain("12345678");
    });
});

describe("authentication from a callback, applied when connecting", () => {
    test("a failing renewal is reported, and the session invalidated once its token expires", async () => {
        let calls = 0;
        const { db, engine } = await connectSession(
            serveSession(),
            () => {
                if (++calls > 1) throw new Error("identity provider is down");
                return createJwtExpiringIn(4);
            },
            { expiryMargin: 1 },
        );
        const errors: Error[] = [];
        const events: unknown[] = [];

        db.subscribe("error", (error) => errors.push(error));
        db.subscribe("auth", (tokens) => events.push(tokens));

        expect(db.accessToken).toBeString();

        // Renewal is attempted a margin before the token expires, and fails
        await until(() => errors.length > 0);

        expect(errors[0]).toBeInstanceOf(AuthResolverError);
        expect(errors[0]).toHaveProperty("name", "AuthResolverError");
        expect(db.accessToken).toBeString();

        // The token is not left behind once it has expired, with nothing to replace it
        await until(() => db.accessToken === undefined);

        expect(events.at(-1)).toBeNull();
        expect(engine.methods()).toContain("invalidate");
    });
});
