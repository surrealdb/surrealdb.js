import { describe, expect, test } from "bun:test";
import { type LiveMessage, RecordId, type Surreal, type SystemAuth, Table } from "surrealdb";
import {
    createIdleSurreal,
    createSurreal,
    SURREAL_PASS,
    SURREAL_PROTOCOL,
    SURREAL_USER,
} from "./__helpers__";

const person = new Table("person");
const root: SystemAuth = { username: SURREAL_USER, password: SURREAL_PASS };

async function caught(promise: Promise<unknown>): Promise<unknown> {
    try {
        await promise;
    } catch (error) {
        return error;
    }

    throw new Error("Expected the promise to reject");
}

/** The live queries which the server holds for the table. */
async function lives(surreal: Surreal): Promise<string[]> {
    const [info] = await surreal
        .query("INFO FOR TABLE person")
        .collect<[{ lives?: Record<string, string> }]>();

    return Object.keys(info?.lives ?? {});
}

/** A connection whose credentials are resolved for each request, on a database which has the table */
async function connectResolving(resolve: () => SystemAuth | Promise<SystemAuth>) {
    const admin = await createSurreal();

    await admin.query(/* surql */ `DEFINE TABLE person SCHEMALESS`);

    const { surreal, connect } = await createIdleSurreal({ auth: "none" });

    await connect({ authentication: { resolve, when: "request" } });

    return surreal;
}

// Live queries need a connection which stays open: WebSocket, and not HTTP
describe.if(SURREAL_PROTOCOL === "ws")(
    "live() on a request scope, with credentials resolved for each request",
    () => {
        test("is registered, delivers, and ends with the signal, while credentials are resolved again", async () => {
            let resolved = 0;
            const surreal = await connectResolving(() => {
                resolved++;
                return root;
            });
            const controller = new AbortController();
            const subscription = await surreal.withSignal(controller.signal).live(person);
            const received: LiveMessage[] = [];
            const reading = (async () => {
                for await (const message of subscription) received.push(message);
            })();

            expect(await lives(surreal)).toHaveLength(1);

            await surreal.create(new RecordId("person", 1)).content({ n: 1 });
            await Bun.sleep(100);

            // Each request resolves its own credential, which the session takes in turn
            const before = resolved;

            await surreal.query("RETURN 1").collect();
            await surreal.query("RETURN 2").collect();

            expect(resolved).toBeGreaterThan(before);

            await surreal.create(new RecordId("person", 2)).content({ n: 2 });
            await Bun.sleep(100);

            // Neither killed nor left unheard by what the session went through
            expect(subscription.isAlive).toBe(true);
            expect(received.map((message) => message.action)).toEqual(["CREATE", "CREATE"]);
            expect(await lives(surreal)).toHaveLength(1);

            controller.abort(new Error("the request went away"));
            await reading;
            await Bun.sleep(100);

            expect(subscription.isAlive).toBe(false);
            expect(await lives(surreal)).toEqual([]);
        });

        test("aborting while the credential is being resolved registers nothing, and the connection carries on", async () => {
            let release: (auth: SystemAuth) => void = () => {};
            let resolved = 0;
            const surreal = await connectResolving(() =>
                ++resolved === 1
                    ? new Promise<SystemAuth>((resolve) => {
                          release = resolve;
                      })
                    : root,
            );

            const reason = new Error("the request went away");
            const controller = new AbortController();
            const registering = caught(
                Promise.resolve(surreal.withSignal(controller.signal).live(person)),
            );

            await Bun.sleep(50);
            controller.abort(reason);

            expect(await registering).toBe(reason);

            // What the resolver comes up with later is for the requests which follow
            release(root);
            await Bun.sleep(200);

            expect(await lives(surreal)).toEqual([]);
            expect(await surreal.query("RETURN 1").collect()).toEqual([1]);
        });
    },
);
