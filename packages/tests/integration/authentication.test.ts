import { beforeAll, describe, expect, mock, test } from "bun:test";
import { satisfies } from "semver";
import { type AnyAuth, RecordId, ResponseError } from "surrealdb";
import { createAuth, requestVersion, setupServer } from "./__helpers__";

const { createSurreal, createIdleSurreal, kill, spawn } = await setupServer();

const version = await requestVersion();
const is3x = satisfies(version, ">=3.0.0-alpha.1");

beforeAll(async () => {
    const surreal = await createSurreal();

    if (is3x) {
        await surreal.query(/* surql */ `
			DEFINE TABLE user PERMISSIONS FOR select WHERE id = $auth;
			DEFINE ACCESS user ON DATABASE TYPE RECORD
				SIGNUP ( CREATE type::record('user', $id) )
				SIGNIN ( SELECT * FROM type::record('user', $id) )
				DURATION FOR TOKEN 61s;
		`);
    } else {
        await surreal.query(/* surql */ `
			DEFINE TABLE user PERMISSIONS FOR select WHERE id = $auth;
			DEFINE ACCESS user ON DATABASE TYPE RECORD
				SIGNUP ( CREATE type::thing('user', $id) )
				SIGNIN ( SELECT * FROM type::thing('user', $id) )
				DURATION FOR TOKEN 61s;
		`);
    }

    await surreal.close();
});

describe("system auth", async () => {
    const surreal = await createSurreal();

    test("root signin", async () => {
        const res = await surreal.signin(createAuth("root") as AnyAuth);
        expect(typeof res.access).toBe("string");
    });

    test("invalid credentials", async () => {
        const req = surreal.signin(createAuth("invalid") as AnyAuth);
        expect(req.then()).rejects.toBeInstanceOf(ResponseError);
    });
});

describe("record auth", async () => {
    const surreal = await createSurreal();

    test("record signup", async () => {
        const signup = await surreal.signup({
            access: "user",
            variables: { id: 123 },
        });

        expect(typeof signup.access).toBe("string");
    });

    test("record signin", async () => {
        const handleAuth = mock(() => {});

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
        const info = await surreal.auth<{ id: RecordId<"user"> }>();
        expect(info).toMatchObject({ id: new RecordId("user", 123) });
    });

    test("invalidate", async () => {
        const handleAuth = mock(() => {});

        surreal.subscribe("auth", handleAuth);

        await surreal.invalidate();

        expect(handleAuth).toBeCalledTimes(1);
        expect(handleAuth).toBeCalledWith(null);
    });
});

describe("session renewal", async () => {
    const { surreal, connect } = createIdleSurreal({
        auth: "none",
    });

    test("invalidateOnExpiry", async () => {
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
        const handleAuth = mock(() => {});

        surreal.subscribe("auth", handleAuth);

        await connect({
            authentication: () => ({
                username: "root",
                password: "root",
            }),
        });

        // Restart the server to force renewal
        await kill();
        await spawn();

        // Should be called only once since the access token is still valid
        expect(handleAuth).toBeCalledTimes(1);
    });
});
