import { beforeEach, describe, expect, mock, test } from "bun:test";
import { AuthResolverError, RecordId, ServerError, surql } from "surrealdb";
import {
    createIdleSurreal,
    createSurreal,
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

const alice = new RecordId("user", "alice");

beforeEach(async () => {
    if (!isRemote) return;

    const root = await createSurreal();
    const record = is3x ? "type::record" : "type::thing";

    await root.query(/* surql */ `
        DEFINE TABLE user PERMISSIONS FOR select WHERE id = $auth;

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
    `);

    await root.close();
});

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
