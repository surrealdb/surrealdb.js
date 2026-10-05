import { beforeEach, describe, expect, test } from "bun:test";
import { HttpConnectionError, type SystemAuth, UnsupportedFeatureError } from "surrealdb";
import {
    createIdleSurreal,
    createSurreal,
    requestVersion,
    SURREAL_BACKEND,
    SURREAL_PASS,
    SURREAL_PROTOCOL,
    SURREAL_USER,
} from "./__helpers__";

// Import and export travel over HTTP whichever protocol the connection uses, and are made with the
// credential of the connection like any other request. What they have to do with the credentials
// which are resolved for each request, with an identity given to a single call, and with the signal
// which abandons a call, is what is checked here against a real server.

const { is3x } = await requestVersion();

const isRemote = SURREAL_BACKEND === "remote";
const isHttp = SURREAL_PROTOCOL === "http";

const root: SystemAuth = { username: SURREAL_USER, password: SURREAL_PASS };

async function rejection(call: PromiseLike<unknown>): Promise<Error & { status?: number }> {
    try {
        await call;
    } catch (error) {
        return error as Error;
    }

    throw new Error("Expected the call to be rejected");
}

beforeEach(async () => {
    if (!isRemote) return;

    const surreal = await createSurreal();
    const record = is3x ? "type::record" : "type::thing";

    // A few rows, and an identity who is let see them and nothing else: an export is a privilege
    await surreal.query(/* surql */ `
        DEFINE TABLE thing SCHEMALESS PERMISSIONS FOR select WHERE true;
        CREATE |thing:20| SET text = rand::string(16);

        DEFINE ACCESS user ON DATABASE TYPE RECORD
            SIGNUP ( CREATE ${record}('user', $id) )
            SIGNIN ( SELECT * FROM ${record}('user', $id) )
            DURATION FOR TOKEN 61s;

        CREATE user:alice;
    `);
});

/** Sign in on a connection of its own, and hand over the token which was issued */
async function tokenOf(auth: "root" | "user"): Promise<string> {
    const surreal = await createSurreal({ auth: "none" });
    const { access } =
        auth === "root"
            ? await surreal.signin(root)
            : await surreal.signin({ access: "user", variables: { id: "alice" } });

    return access;
}

describe.skipIf(!isRemote)("an import or export with credentials resolved for each request", () => {
    test("presents the credential which is resolved for it", async () => {
        let resolved = 0;
        const { surreal, connect } = await createIdleSurreal({ auth: "none" });

        await connect({
            authentication: {
                resolve: () => {
                    resolved++;
                    return root;
                },
                when: "request",
            },
        });

        expect(await surreal.export()).toContain("thing");
        await surreal.import(`OPTION IMPORT;\nCREATE thing:imported SET text = 'imported';`);

        // Neither was made without a credential: the server would not have let them be
        expect(resolved).toBeGreaterThanOrEqual(2);

        const [rows] = await surreal.query("SELECT * FROM thing:imported").collect();

        expect(rows).toHaveLength(1);
    });

    test("is abandoned while the credential is being resolved, and the connection carries on", async () => {
        let release: (auth: SystemAuth) => void = () => {};
        let resolved = 0;
        const { surreal, connect } = await createIdleSurreal({ auth: "none" });

        await connect({
            authentication: {
                resolve: () =>
                    ++resolved === 1
                        ? new Promise<SystemAuth>((resolve) => {
                              release = resolve;
                          })
                        : root,
                when: "request",
            },
        });

        const reason = new Error("the client went away");
        const controller = new AbortController();

        setTimeout(() => controller.abort(reason), 50);

        const started = performance.now();

        expect(await rejection(surreal.export().signal(controller.signal))).toBe(reason);
        expect(performance.now() - started).toBeLessThan(2000);

        // What was being resolved is let finish, and nothing is left in the way of the next
        release(root);

        expect(await surreal.export()).toContain("thing");
        await surreal.import(`OPTION IMPORT;\nCREATE thing:imported SET text = 'imported';`);
    });

    test("is held to its own request timeout while it waits for the credential", async () => {
        const { surreal, connect } = await createIdleSurreal({ auth: "none" });

        await connect({
            requestTimeout: 25,
            authentication: {
                resolve: async () => {
                    await Bun.sleep(100);
                    return root;
                },
                when: "request",
            },
        });

        // The limit of the connection is for queries, and does not cut an export short
        expect(await surreal.export()).toContain("thing");

        const error = await rejection(surreal.export().requestTimeout(25));

        expect(error.name).toBe("TimeoutError");
    });
});

describe.skipIf(!isRemote || !isHttp)("an import or export which is run as someone else", () => {
    test("is run as the identity it was asked to be, and not as the connection", async () => {
        const surreal = await createSurreal();
        const user = await tokenOf("user");

        // The connection is allowed to export, and the identity which is asked for is not
        expect(await surreal.export()).toContain("thing");

        const error = await rejection(surreal.export().as(user));

        expect(error).toBeInstanceOf(HttpConnectionError);
        expect([401, 403]).toContain(error.status as number);
    });

    test("is let do what the identity is let, when the connection could not", async () => {
        const { surreal, connect } = await createIdleSurreal({ auth: "none" });
        await connect();

        const rootToken = await tokenOf("root");

        // As itself, the connection is nobody, and is refused
        expect(await rejection(surreal.export())).toBeInstanceOf(HttpConnectionError);

        expect(await surreal.export().as(rootToken)).toContain("thing");
        expect(await surreal.export().as(root)).toContain("thing");
    });

    test("an import is applied as the identity it was asked to be", async () => {
        const surreal = await createSurreal();
        const user = await tokenOf("user");
        const refused = await rejection(
            surreal.import(`OPTION IMPORT;\nCREATE thing:refused SET text = 'refused';`).as(user),
        );

        expect(refused).toBeInstanceOf(HttpConnectionError);

        await surreal
            .import(`OPTION IMPORT;\nCREATE thing:allowed SET text = 'allowed';`)
            .as(await tokenOf("root"));

        const [refusedRows] = await surreal.query("SELECT * FROM thing:refused").collect();
        const [allowedRows] = await surreal.query("SELECT * FROM thing:allowed").collect();

        expect(refusedRows).toHaveLength(0);
        expect(allowedRows).toHaveLength(1);
    });

    test("is abandoned with the signal, as whoever it is run as", async () => {
        const surreal = await createSurreal();
        const rootToken = await tokenOf("root");
        const reason = new Error("the client went away");
        const controller = new AbortController();

        controller.abort(reason);

        expect(await rejection(surreal.export().as(rootToken).signal(controller.signal))).toBe(
            reason,
        );
        expect(await surreal.export().as(rootToken)).toContain("thing");
    });
});

describe.skipIf(isHttp)(
    "an import or export which is run as someone else, where it cannot be",
    () => {
        test("is refused, rather than run as the connection", async () => {
            const surreal = await createSurreal();

            expect(await rejection(surreal.export().as("a-token"))).toBeInstanceOf(
                UnsupportedFeatureError,
            );
            expect(
                await rejection(
                    surreal.import(`OPTION IMPORT;\nCREATE thing:refused;`).as("a-token"),
                ),
            ).toBeInstanceOf(UnsupportedFeatureError);
        });
    },
);
