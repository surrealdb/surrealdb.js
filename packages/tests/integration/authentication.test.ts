import { beforeEach, describe, expect, mock, test } from "bun:test";
import { type AnyAuth, DateTime, RecordId, ServerError, surql } from "surrealdb";
import {
    createAuth,
    createIdleSurreal,
    createSurreal,
    requestVersion,
    respawnServer,
    SURREAL_BACKEND,
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
    test("basic", async () => {
        const { connect } = await createIdleSurreal({
            auth: "none",
        });

        const authentication = mock(() => ({
            username: "test",
            password: "test",
        }));

        await connect({
            authentication,
        });

        // Wait at least 1s for token to renew
        await Bun.sleep(1500);

        // Should be called twice in this timeframe
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
        });

        await surreal.signup({
            access: "user",
            variables: { id: 456 },
        });

        // Wait at least 1s for token to renew
        await Bun.sleep(1500);

        // One authentication, one renewal
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
});
