import { beforeEach, describe, expect, mock, test } from "bun:test";
import { AuthResolverError, type Diagnostic, RecordId, ServerError, surql } from "surrealdb";
import {
    createIdleSurreal,
    createSurreal,
    getEngines,
    requestVersion,
    SURREAL_BACKEND,
    SURREAL_PROTOCOL,
} from "./__helpers__";

/** What a rejected call is expected to have thrown, for the properties the tests look at */
type Failure = Error & {
    status?: number;
    cause?: unknown;
    isTokenExpired?: boolean;
    feature?: unknown;
};

/** The error a call is rejected with, which the test is about to look at */
async function rejection(call: PromiseLike<unknown>): Promise<Failure> {
    try {
        await call;
    } catch (error) {
        return error as Failure;
    }

    throw new Error("Expected the call to be rejected");
}

const { is3x } = await requestVersion();
const isRemote = SURREAL_BACKEND === "remote";
const isHttp = SURREAL_PROTOCOL === "http";
const isWebSocket = SURREAL_PROTOCOL === "ws";

const alice = new RecordId("user", "alice");
const bob = new RecordId("user", "bob");

beforeEach(async () => {
    if (!isRemote) return;

    const root = await createSurreal();
    const record = is3x ? "type::record" : "type::thing";

    await root.query(/* surql */ `
        DEFINE TABLE user PERMISSIONS FOR select WHERE id = $auth;
        DEFINE TABLE note PERMISSIONS FOR select, create WHERE owner = $auth;

        DEFINE ACCESS user ON DATABASE TYPE RECORD
            SIGNUP ( CREATE ${record}('user', $id) )
            SIGNIN ( SELECT * FROM ${record}('user', $id) )
            DURATION FOR TOKEN 61s;

        -- Tokens which expire quickly, to see what happens when they do
        DEFINE ACCESS short_user ON DATABASE TYPE RECORD
            SIGNUP ( CREATE ${record}('user', $id) )
            SIGNIN ( SELECT * FROM ${record}('user', $id) )
            DURATION FOR TOKEN 2s;

        CREATE user:alice;
        CREATE user:bob;
        CREATE note:one SET owner = user:alice;
        CREATE note:two SET owner = user:bob;
    `);

    await root.close();
});

/** Sign in on a connection of its own, and hand over the token which was issued */
async function tokenFor(id: string, access = "user"): Promise<string> {
    const surreal = await createSurreal({ auth: "none" });
    const { access: token } = await surreal.signin({ access, variables: { id } });

    return token;
}

describe.skipIf(!isRemote)("record access from a callback", () => {
    test("is used when connecting", async () => {
        const { surreal, connect } = await createIdleSurreal({ auth: "none" });
        const authentication = mock(() => ({ access: "user", variables: { id: "alice" } }));

        await connect({ authentication });

        expect(authentication).toBeCalledTimes(1);
        expect(surreal.accessToken).toBeString();
        expect(await surreal.auth<{ id: RecordId }>()).toMatchObject({ id: alice });
    });

    test("is a static value too", async () => {
        const { surreal, connect } = await createIdleSurreal({ auth: "none" });

        await connect({ authentication: { access: "user", variables: { id: "alice" } } });

        expect(await surreal.auth<{ id: RecordId }>()).toMatchObject({ id: alice });
    });

    // Tokens issued by a bearer access method are not accepted by the server in the Authorization
    // header of an HTTP request, which is how every request over HTTP is authenticated
    test.skipIf(!is3x || isHttp)("can be a bearer access key", async () => {
        const root = await createSurreal();

        await root.query(surql`
            DEFINE ACCESS bearer ON DATABASE TYPE BEARER FOR RECORD DURATION FOR GRANT 60s FOR TOKEN 60s;
        `);

        const [grant] = await root
            .query<[{ grant: { key: string } }]>(surql`ACCESS bearer GRANT FOR RECORD user:alice;`)
            .collect();

        const { surreal, connect } = await createIdleSurreal({ auth: "none" });

        await connect({
            authentication: () => ({
                namespace: "test",
                database: "test",
                access: "bearer",
                key: grant.grant.key,
            }),
        });

        expect(await surreal.auth<{ id: RecordId }>()).toMatchObject({ id: alice });
    });

    test("fails the connection with a typed error when the callback throws", async () => {
        const { connect } = await createIdleSurreal({ auth: "none" });
        const failure = new Error("identity provider is down");

        const error = await rejection(
            connect({
                authentication: () => {
                    throw failure;
                },
            }),
        );

        expect(error).toBeInstanceOf(AuthResolverError);
        expect(error.cause).toBe(failure);
    });

    test("is refused by the server when the details are wrong, as a server error", async () => {
        const { connect } = await createIdleSurreal({ auth: "none" });

        const error = await rejection(
            connect({
                authentication: () => ({ access: "no_such_access", variables: { id: "alice" } }),
            }),
        );

        expect(error).toBeInstanceOf(ServerError);
    });
});

describe.skipIf(!isRemote)("a failing renewal", () => {
    test("is reported, and the session is invalidated once its token expires", async () => {
        const { surreal, connect } = await createIdleSurreal({ auth: "none" });
        const errors: Error[] = [];
        const events: unknown[] = [];
        let calls = 0;

        surreal.subscribe("error", (error) => errors.push(error));
        surreal.subscribe("auth", (tokens) => events.push(tokens));

        await connect({
            authentication: () => {
                if (++calls > 1) throw new Error("identity provider is down");
                return { access: "short_user", variables: { id: "alice" } };
            },
            expiryMargin: 1,
        });

        expect(surreal.accessToken).toBeString();

        // Renewal at about a second, which fails, and expiry at about two
        await Bun.sleep(1500);
        expect(errors[0]).toBeInstanceOf(AuthResolverError);
        expect(surreal.accessToken).toBeString();

        await Bun.sleep(2000);
        expect(surreal.accessToken).toBeUndefined();
        expect(events.at(-1)).toBeNull();
    });
});

describe.skipIf(!isRemote)("authentication resolved per request", () => {
    test("is not resolved until a request needs it", async () => {
        const { surreal, connect } = await createIdleSurreal({ auth: "none" });
        const resolve = mock(() => ({ access: "user", variables: { id: "alice" } }));

        await connect({ authentication: { resolve, when: "request" } });
        expect(resolve).toBeCalledTimes(0);

        expect(await surreal.auth<{ id: RecordId }>()).toMatchObject({ id: alice });
        expect(resolve).toBeCalledTimes(1);
    });

    test("is reused until the token expires", async () => {
        const { surreal, connect } = await createIdleSurreal({ auth: "none" });
        const resolve = mock(() => ({ access: "user", variables: { id: "alice" } }));

        await connect({ authentication: { resolve, when: "request", cache: "until-expiry" } });

        for (let i = 0; i < 5; i++) {
            expect(await surreal.auth<{ id: RecordId }>()).toMatchObject({ id: alice });
        }

        expect(resolve).toBeCalledTimes(1);
    });

    test("shares one resolution between concurrent requests", async () => {
        const { surreal, connect } = await createIdleSurreal({ auth: "none" });
        const resolve = mock(async () => {
            await Bun.sleep(25);
            return { access: "user", variables: { id: "alice" } };
        });

        await connect({ authentication: { resolve, when: "request" } });

        const results = await Promise.all(
            Array.from({ length: 8 }, () => surreal.auth<{ id: RecordId }>()),
        );

        expect(results.every((me) => me?.id.toString() === alice.toString())).toBeTrue();
        expect(resolve).toBeCalledTimes(1);
    });

    test("resolves again once the token is about to expire", async () => {
        const { surreal, connect } = await createIdleSurreal({ auth: "none" });
        const resolve = mock(() => ({ access: "short_user", variables: { id: "alice" } }));

        await connect({
            authentication: { resolve, when: "request" },
            expiryMargin: 1,
        });

        await surreal.auth();
        expect(resolve).toBeCalledTimes(1);

        // The token lives for two seconds and is reused for at most one of them
        await Bun.sleep(1500);

        expect(await surreal.auth<{ id: RecordId }>()).toMatchObject({ id: alice });
        expect(await surreal.auth<{ id: RecordId }>()).toMatchObject({ id: alice });
        expect(resolve).toBeCalledTimes(2);
    });

    test("notices a token which is rotated out of band", async () => {
        const forAlice = await tokenFor("alice");
        const forBob = await tokenFor("bob");
        const { surreal, connect } = await createIdleSurreal({ auth: "none" });
        let current = forAlice;

        await connect({
            authentication: { resolve: () => current, when: "request", cache: "none" },
        });

        expect(await surreal.auth<{ id: RecordId }>()).toMatchObject({ id: alice });

        current = forBob;

        expect(await surreal.auth<{ id: RecordId }>()).toMatchObject({ id: bob });

        current = forAlice;

        expect(await surreal.auth<{ id: RecordId }>()).toMatchObject({ id: alice });
    });

    test("uses an opaque token for as long as the ttl allows", async () => {
        const token = await tokenFor("alice");
        const { surreal, connect } = await createIdleSurreal({ auth: "none" });
        const resolve = mock(() => token);

        await connect({ authentication: { resolve, when: "request", cache: { ttl: 30 } } });

        await surreal.auth();
        await surreal.auth();

        // The token is a JWT, so the ttl only bounds it
        expect(resolve).toBeCalledTimes(1);
    });

    test("fails the request with a typed error when the resolver throws, and recovers", async () => {
        const { surreal, connect } = await createIdleSurreal({ auth: "none" });
        let failing = true;
        const failure = new Error("vault is sealed");

        await connect({
            authentication: {
                resolve: () => {
                    if (failing) throw failure;
                    return { access: "user", variables: { id: "bob" } };
                },
                when: "request",
            },
        });

        const error = await rejection(surreal.auth());

        expect(error).toBeInstanceOf(AuthResolverError);
        expect(error.cause).toBe(failure);
        expect(surreal.accessToken).toBeUndefined();

        failing = false;

        expect(await surreal.auth<{ id: RecordId }>()).toMatchObject({ id: bob });
    });

    test("does not run the request without credentials when the resolver fails", async () => {
        const { surreal, connect } = await createIdleSurreal({ auth: "none" });
        const root = await createSurreal();

        await connect({
            authentication: {
                resolve: () => {
                    throw new Error("down");
                },
                when: "request",
            },
        });

        const error = await rejection(
            surreal.create(new RecordId("note", "unauthenticated")).content({ owner: alice }),
        );

        expect(error).toBeInstanceOf(AuthResolverError);

        expect(await root.select(new RecordId("note", "unauthenticated"))).toBeUndefined();
    });

    test("yields to a sign in made by hand", async () => {
        const { surreal, connect } = await createIdleSurreal({ auth: "none" });
        const resolve = mock(() => ({ access: "user", variables: { id: "alice" } }));

        await connect({ authentication: { resolve, when: "request" } });
        await surreal.signin({ access: "user", variables: { id: "bob" } });

        expect(await surreal.auth<{ id: RecordId }>()).toMatchObject({ id: bob });
        expect(resolve).toBeCalledTimes(0);
    });

    test("is dropped by invalidating the session, and resolved again", async () => {
        const { surreal, connect } = await createIdleSurreal({ auth: "none" });
        const resolve = mock(() => ({ access: "user", variables: { id: "alice" } }));

        await connect({ authentication: { resolve, when: "request" } });

        await surreal.auth();
        await surreal.invalidate();
        expect(await surreal.auth<{ id: RecordId }>()).toMatchObject({ id: alice });
        expect(resolve).toBeCalledTimes(2);
    });

    test("serves exports", async () => {
        const { surreal, connect } = await createIdleSurreal({ auth: "none" });
        const root = await createSurreal({ auth: "root" });

        await root.query(surql`DEFINE USER exporter ON DATABASE PASSWORD 'secret' ROLES OWNER;`);

        const resolve = mock(() => ({
            namespace: "test",
            database: "test",
            username: "exporter",
            password: "secret",
        }));

        await connect({ authentication: { resolve, when: "request" } });

        expect(await surreal.export()).toContain("DEFINE TABLE");
        expect(resolve).toBeCalledTimes(1);
    });

    describe.skipIf(!isHttp)("over HTTP", () => {
        test("replaces a token which the server refuses, and sends the request again", async () => {
            const stale = await tokenFor("alice", "short_user");

            // The token lives for two seconds, and the server forgives a little longer
            await Bun.sleep(3500);

            const fresh = await tokenFor("alice");
            const { surreal, connect } = await createIdleSurreal({ auth: "none" });
            const tokens = [stale, fresh];
            let calls = 0;

            await connect({
                authentication: { resolve: () => tokens[calls++], when: "request" },
            });

            // The server answers 401 to an expired token before it runs anything, so
            // sending the write again cannot apply it twice
            await surreal.query("CREATE note:three SET owner = user:alice");

            const root = await createSurreal();

            expect(calls).toBe(2);
            expect(await root.select(new RecordId("note", "three"))).toMatchObject({
                owner: alice,
            });
        });

        test("gives up when the replacement is refused as well", async () => {
            const stale = await tokenFor("alice", "short_user");

            await Bun.sleep(3500);

            const { surreal, connect } = await createIdleSurreal({ auth: "none" });
            const resolve = mock(() => stale);

            await connect({ authentication: { resolve, when: "request", cache: "none" } });

            const error = await rejection(surreal.query("RETURN 1").collect());

            // Nothing new to try: the resolver gave the very token which was refused
            expect(error.status).toBe(401);
            expect(resolve).toBeCalledTimes(2);
        });
    });

    describe.skipIf(!isWebSocket)("over WebSocket", () => {
        test("authenticates the session again only when the credential changes", async () => {
            const forAlice = await tokenFor("alice");
            const forBob = await tokenFor("bob");
            const events: Diagnostic[] = [];
            const engines = await getEngines((event) => events.push(event));
            const { surreal, connect } = await createIdleSurreal({
                auth: "none",
                driverOptions: { engines },
            });

            let current = forAlice;

            await connect({
                authentication: { resolve: () => current, when: "request", cache: "none" },
            });

            const authentications = () =>
                events.filter((e) => e.type === "authenticate" && e.phase === "before").length;

            await surreal.auth();
            await surreal.auth();
            await surreal.auth();

            // The resolver is asked every time, but the server is only told about it once
            expect(authentications()).toBe(1);
            expect(surreal.accessToken).toBe(forAlice);

            current = forBob;

            expect(await surreal.auth<{ id: RecordId }>()).toMatchObject({ id: bob });
            expect(authentications()).toBe(2);
            expect(surreal.accessToken).toBe(forBob);
        });

        test("does not leave the session half authenticated when the token is refused", async () => {
            const forAlice = await tokenFor("alice");
            const { surreal, connect } = await createIdleSurreal({ auth: "none" });
            let current = forAlice;

            await connect({
                authentication: { resolve: () => current, when: "request", cache: "none" },
            });

            expect(await surreal.auth<{ id: RecordId }>()).toMatchObject({ id: alice });

            current = "not-a-token";

            const error = await rejection(surreal.auth());

            // The request was never sent, and the session still is who it was
            expect(error).toBeInstanceOf(ServerError);
            expect(surreal.accessToken).toBe(forAlice);

            current = forAlice;

            expect(await surreal.auth<{ id: RecordId }>()).toMatchObject({ id: alice });
        });
    });
});
