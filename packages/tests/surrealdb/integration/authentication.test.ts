import { beforeEach, describe, expect, mock, test } from "bun:test";
import {
    type AnyAuth,
    DateTime,
    PublishError,
    RecordId,
    ServerError,
    SurrealError,
    surql,
} from "surrealdb";
import {
    createAuth,
    createIdleSurreal,
    createSurreal,
    requestVersion,
    respawnServer,
    SURREAL_BACKEND,
    SURREAL_PROTOCOL,
} from "./__helpers__";

const { is3x } = await requestVersion();
const isRemote = SURREAL_BACKEND === "remote";

beforeEach(async () => {
    if (!isRemote) return;
    const surreal = await createSurreal();

    if (is3x) {
        await surreal.query(/* surql */ `
			DEFINE TABLE user PERMISSIONS FOR select WHERE id = $auth;
			DEFINE USER IF NOT EXISTS test ON ROOT PASSWORD 'test' ROLES OWNER DURATION FOR TOKEN 61s;
			DEFINE ACCESS user ON DATABASE TYPE RECORD
				SIGNUP ( CREATE type::record('user', $id) )
				SIGNIN ( SELECT * FROM type::record('user', $id) )
				DURATION FOR TOKEN 61s;

            DEFINE ACCESS user_with_refresh ON DATABASE 
                TYPE RECORD
                    SIGNUP ( CREATE type::record('user', $id) )
                    SIGNIN ( SELECT * FROM type::record('user', $id) )
                    WITH REFRESH
				DURATION FOR TOKEN 61s;

            DEFINE USER IF NOT EXISTS test ON DATABASE PASSWORD 'test' ROLES OWNER DURATION FOR TOKEN 61s;
            DEFINE ACCESS bearer ON DATABASE TYPE BEARER FOR USER DURATION FOR GRANT 60s FOR TOKEN 60s;
		`);
    } else {
        await surreal.query(/* surql */ `
			DEFINE TABLE user PERMISSIONS FOR select WHERE id = $auth;
			DEFINE USER IF NOT EXISTS test ON ROOT PASSWORD 'test' ROLES OWNER DURATION FOR TOKEN 61s;
			DEFINE ACCESS user ON DATABASE TYPE RECORD
				SIGNUP ( CREATE type::thing('user', $id) )
				SIGNIN ( SELECT * FROM type::thing('user', $id) )
				DURATION FOR TOKEN 61s;
		`);
    }

    await surreal.close();
});

describe.skipIf(!isRemote)("system auth", async () => {
    test("root signin", async () => {
        const surreal = await createSurreal();
        const res = await surreal.signin(createAuth("root") as AnyAuth);

        expect(typeof res.access).toBe("string");
    });

    test("invalid credentials", async () => {
        const surreal = await createSurreal();
        const req = surreal.signin(createAuth("invalid") as AnyAuth);

        expect(req.then()).rejects.toBeInstanceOf(ServerError);
    });
});

describe.skipIf(!isRemote)("record auth", async () => {
    test("record signup", async () => {
        const surreal = await createSurreal();
        const signup = await surreal.signup({
            access: "user",
            variables: { id: 123 },
        });

        expect(typeof signup.access).toBe("string");
    });

    test("record signin", async () => {
        const surreal = await createSurreal();
        const handleAuth = mock(() => {});

        await surreal.create(new RecordId("user", 123));

        surreal.subscribe("auth", handleAuth);

        const signin = await surreal.signin({
            access: "user",
            variables: { id: 123 },
        });

        expect(typeof signin.access).toBe("string");
        expect(handleAuth).toBeCalledTimes(1);
        expect(handleAuth).toBeCalledWith(signin);
    });

    test("info", async () => {
        const surreal = await createSurreal();

        await surreal.create(new RecordId("user", 123));

        await surreal.signin({
            access: "user",
            variables: { id: 123 },
        });

        const info = await surreal.auth<{ id: RecordId<"user"> }>();
        expect(info).toMatchObject({ id: new RecordId("user", 123) });
    });

    test("invalidate", async () => {
        const surreal = await createSurreal();
        const handleAuth = mock(() => {});

        await surreal.create(new RecordId("user", 123));

        await surreal.signin({
            access: "user",
            variables: { id: 123 },
        });

        surreal.subscribe("auth", handleAuth);

        await surreal.invalidate();

        expect(handleAuth).toBeCalledTimes(1);
        expect(handleAuth).toBeCalledWith(null);
    });
});

describe.skipIf(!isRemote)("session renewal", async () => {
    beforeEach(async () => {
        const surreal = await createSurreal();

        if (is3x) {
            await surreal.query(/* surql */ `
                DEFINE USER IF NOT EXISTS renewal_test ON ROOT PASSWORD 'test' ROLES OWNER DURATION FOR TOKEN 2s;
                DEFINE ACCESS IF NOT EXISTS renewal_user ON DATABASE TYPE RECORD
                    SIGNUP ( CREATE type::record('user', $id) )
                    SIGNIN ( SELECT * FROM type::record('user', $id) )
                    DURATION FOR TOKEN 2s;
            `);
        } else {
            await surreal.query(/* surql */ `
                DEFINE USER IF NOT EXISTS renewal_test ON ROOT PASSWORD 'test' ROLES OWNER DURATION FOR TOKEN 2s;
                DEFINE ACCESS IF NOT EXISTS renewal_user ON DATABASE TYPE RECORD
                    SIGNUP ( CREATE type::thing('user', $id) )
                    SIGNIN ( SELECT * FROM type::thing('user', $id) )
                    DURATION FOR TOKEN 2s;
            `);
        }

        await surreal.close();
    });

    test("basic", async () => {
        const { connect } = await createIdleSurreal({
            auth: "none",
        });

        const authentication = mock(() => ({
            username: "renewal_test",
            password: "test",
        }));

        await connect({
            authentication,
            expiryMargin: 1,
        });

        // 2s token with 1s expiry margin schedules renewal after 1s
        await Bun.sleep(1500);

        expect(authentication).toBeCalledTimes(2);
    });

    test("invalidateOnExpiry", async () => {
        const { surreal, connect } = await createIdleSurreal({
            auth: "none",
        });

        const handleAuth = mock(() => {});

        surreal.subscribe("auth", handleAuth);

        await connect({
            invalidateOnExpiry: true,
            expiryMargin: 1,
        });

        await surreal.signup({
            access: "renewal_user",
            variables: { id: 456 },
        });

        // 2s token with 1s expiry margin schedules invalidation after 1s
        await Bun.sleep(1500);

        expect(handleAuth).toBeCalledTimes(2);
    });

    test("reuse existing access", async () => {
        const { surreal, connect } = await createIdleSurreal({
            auth: "none",
        });

        const handleAuth = mock(() => {});

        surreal.subscribe("auth", handleAuth);

        await connect({
            authentication: () => ({
                username: "root",
                password: "root",
            }),
        });

        // Restart the server to force renewal
        await respawnServer();

        // Should be called only once since the access token is still valid
        expect(handleAuth).toBeCalledTimes(1);
    });

    test("null result", async () => {
        const { surreal, connect } = await createIdleSurreal({
            auth: "none",
        });

        const handleAuth = mock(() => {});

        surreal.subscribe("auth", handleAuth);

        await connect({
            authentication: () => null,
        });

        expect(handleAuth).toBeCalledTimes(0);
    });
});

describe.skipIf(!isRemote || !is3x)("bearer access", async () => {
    test("record signup with refresh", async () => {
        const surreal = await createSurreal();

        const res1 = await surreal.signup({
            access: "user_with_refresh",
            variables: {
                id: 123,
            },
        });

        expect(res1.access).toBeString();
        expect(res1.refresh).toBeString();

        const res2 = await surreal.authenticate(res1);
        expect(res2.access).toBeString();
        expect(res2.refresh).toBeString();
        expect(res2.refresh).not.toBe(res1.refresh);
        expect(res2.access).not.toBe(res1.access);
    });

    test("revoke a refresh token", async () => {
        const surreal = await createSurreal();
        const tokens = await surreal.signup({
            access: "user_with_refresh",
            variables: { id: 124 },
        });

        await surreal.revoke(tokens);

        await expect(surreal.authenticate(tokens)).rejects.toBeInstanceOf(ServerError);
    });

    test("revoke the refresh token of the session", async () => {
        const surreal = await createSurreal();
        const tokens = await surreal.signup({
            access: "user_with_refresh",
            variables: { id: 125 },
        });

        await surreal.revoke();

        // The session stays authenticated until its access token expires
        expect(surreal.accessToken).toBe(tokens.access);
        await expect(surreal.authenticate(tokens)).rejects.toBeInstanceOf(ServerError);
        await expect(surreal.revoke()).rejects.toBeInstanceOf(SurrealError);
    });

    test.if(SURREAL_PROTOCOL === "ws")(
        "revoke the refresh token of a session, and of those forked from it",
        async () => {
            const surreal = await createSurreal();
            await surreal.signup({
                access: "user_with_refresh",
                variables: { id: 126 },
            });

            const forked = await surreal.forkSession();
            const announced: unknown[] = [];

            forked.subscribe("auth", (tokens) => announced.push(tokens));

            await surreal.revoke();

            // The forked session is told it is left with its access token alone
            expect(announced).toEqual([{ access: surreal.accessToken, refresh: undefined }]);

            // The forked session holds the same refresh token, so it has none left to revoke
            await expect(forked.revoke()).rejects.toThrow("There is no refresh token to revoke");
            await forked.closeSession();
        },
    );

    test.if(SURREAL_PROTOCOL === "ws")(
        "a listener which throws does not leave a forked session holding a revoked token",
        async () => {
            const surreal = await createSurreal();
            await surreal.signup({
                access: "user_with_refresh",
                variables: { id: 127 },
            });

            const forked = await surreal.forkSession();

            surreal.subscribe("auth", () => {
                throw new Error("root listener failed");
            });

            forked.subscribe("auth", () => {
                throw new Error("forked listener failed");
            });

            const error = await surreal.revoke().then(
                () => undefined,
                (error: unknown) => error,
            );

            // Every listener which failed is reported, whichever session it listened to
            expect(error).toBeInstanceOf(PublishError);
            expect((error as PublishError).message).toContain("root listener failed");
            expect((error as PublishError).message).toContain("forked listener failed");
            await expect(forked.revoke()).rejects.toThrow("There is no refresh token to revoke");
            await forked.closeSession();
        },
    );

    test("system user", async () => {
        const surreal = await createSurreal({
            auth: "root",
        });

        interface BearerGrant {
            ac: string;
            creation: DateTime;
            expiration: DateTime;
            grant: {
                id: string;
                key: string;
            };
            id: string;
            subject: {
                user: string;
            };
            type: "bearer";
        }

        const [grant] = await surreal
            .query<[BearerGrant]>(surql`
            ACCESS bearer GRANT FOR USER test;
        `)
            .collect();

        expect(grant.ac).toBe("bearer");
        expect(grant.creation).toBeInstanceOf(DateTime);
        expect(grant.expiration).toBeInstanceOf(DateTime);
        expect(grant.grant.id).toBeString();
        expect(grant.grant.key).toBeString();
        expect(grant.id).toBeString();
        expect(grant.subject.user).toBe("test");
        expect(grant.type).toBe("bearer");

        const diff = grant.expiration.diff(grant.creation);
        expect(diff.seconds).toBe(60n);

        const res = await surreal.signin({
            namespace: "test",
            database: "test",
            access: "bearer",
            key: grant.grant.key,
        });

        expect(res.access).toBeString();
    });

    test.skipIf(!is3x)("namespace bearer signin omits the database", async () => {
        const surreal = await createSurreal({ auth: "root" });

        await surreal.query(surql`
            DEFINE ACCESS ns_bearer ON NAMESPACE TYPE BEARER FOR USER DURATION FOR GRANT 60s FOR TOKEN 60s;
            DEFINE USER ns_tester ON NAMESPACE PASSWORD 'test' ROLES OWNER;
        `);

        const [grant] = await surreal
            .query<[{ grant: { key: string } }]>(surql`
                ACCESS ns_bearer ON NAMESPACE GRANT FOR USER ns_tester;
            `)
            .collect();

        // A namespace-level bearer carries no database, so signin must omit the
        // database rather than send a null that misroutes to the database path.
        const res = await surreal.signin({
            namespace: "test",
            access: "ns_bearer",
            key: grant.grant.key,
        });

        expect(res.access).toBeString();
    });
});
