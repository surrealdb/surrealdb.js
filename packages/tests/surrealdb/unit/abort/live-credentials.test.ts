import { afterEach, describe, expect, test } from "bun:test";
import {
    ChannelIterator,
    type ConnectOptions,
    Features,
    type LiveMessage,
    RecordId,
    type Surreal,
    Table,
    Uuid,
} from "../../../../sdk/src";
import { FakeClock } from "../__helpers__/fake-clock";
import { connectFake, type FakeEngine } from "../__helpers__/mock-engine";
import { createJwtExpiringIn, deferred } from "../__helpers__/mock-fetch";
import {
    closeSessionClients,
    connect as connectSession,
    serve,
} from "../__helpers__/session-engine";

// A live query is registered with a request like any other, and when the connection resolves the
// credential for each request, the session needs one before that request is sent. What a scope's
// signal does to the registration which is waiting for it, and what a credential which is resolved
// again does to a subscription which is running, is what is checked here.

const person = new Table("person");

let open: Surreal | undefined;
let clock: FakeClock | undefined;

afterEach(async () => {
    clock?.uninstall();
    clock = undefined;
    await open?.close();
    open = undefined;
    await closeSessionClients();
});

/** Let whatever is waiting on a promise run */
async function flush(): Promise<void> {
    for (let i = 0; i < 50; i++) await Promise.resolve();
}

/** Wait until the condition holds, polling in time */
async function until(condition: () => boolean, timeout = 2000): Promise<void> {
    const start = Date.now();

    while (!condition()) {
        if (Date.now() - start > timeout) throw new Error("The condition was not met in time");
        await Bun.sleep(1);
    }
}

async function caught(promise: Promise<unknown>): Promise<unknown> {
    try {
        await promise;
    } catch (error) {
        return error;
    }

    throw new Error("Expected the promise to reject");
}

const ok = (result: unknown = []) => [{ status: "OK", time: "1ms", result, type: "other" }];

/** Credentials which are resolved for each request */
const perRequest = (resolve: () => string | Promise<string>, cache?: "none" | "until-expiry") => ({
    resolve,
    when: "request" as const,
    cache,
});

/** What a fake server which registers live queries is asked, and what it notifies */
function newServer() {
    const id = Uuid.v4();
    const log = { registered: 0, kills: [] as string[], cleaned: 0 };
    const channels: ChannelIterator<LiveMessage>[] = [];

    return {
        id,
        log,
        liveImpl: () => {
            const channel = new ChannelIterator<LiveMessage>(() => {
                log.cleaned++;
            });

            channels.push(channel);

            return channel;
        },
        /** Answers what a query request asks */
        answer: (text: string) => {
            if (text.includes("KILL")) {
                log.kills.push(text);
                return ok();
            }

            if (text.includes("LIVE SELECT")) {
                log.registered++;
                return [{ status: "OK", time: "1ms", result: id, type: "live" }];
            }

            return ok();
        },
        notify: (n: number) => {
            for (const channel of channels) {
                channel.submit({
                    queryId: id,
                    action: "CREATE",
                    recordId: new RecordId("person", n),
                    value: { n },
                });
            }
        },
    };
}

/** A connection on an engine which keeps credentials in a session, with a fake server behind it */
async function connectFor(authentication: ConnectOptions["authentication"]) {
    const connected = await connectFake({ authentication });
    const fake = newServer();

    open = connected.db;
    connected.engine.liveImpl = fake.liveImpl;
    connected.engine.respond = async (request) =>
        request.method === "query" ? fake.answer(String(request.params?.[0] ?? "")) : ok();

    return { ...connected, fake };
}

const methods = (engine: FakeEngine) => engine.sent.map(({ request }) => request.method);
const registrations = (engine: FakeEngine) =>
    engine.sent.filter(
        ({ request }) =>
            request.method === "query" && String(request.params?.[0]).includes("LIVE SELECT"),
    );

describe("live() on a request scope, with credentials resolved for each request", () => {
    test("the session is authenticated before the live query is registered", async () => {
        const { db, engine, fake } = await connectFor(perRequest(() => "session-token"));
        const controller = new AbortController();
        const subscription = await db.withSignal(controller.signal).live(person);

        expect(subscription.isAlive).toBe(true);
        expect(methods(engine).filter((method) => method !== "version")).toEqual([
            "authenticate",
            "query",
        ]);
        expect(fake.log.registered).toBe(1);
    });

    test("a signal which has aborted already resolves no credential, and registers nothing", async () => {
        let resolved = 0;
        const { db, engine, fake } = await connectFor(perRequest(() => `token-${++resolved}`));
        const reason = new Error("the request is already gone");

        const error = await caught(
            Promise.resolve(db.withSignal(AbortSignal.abort(reason)).live(person)),
        );

        expect(error).toBe(reason);
        expect(resolved).toBe(0);
        expect(registrations(engine)).toHaveLength(0);
        expect(fake.log.registered).toBe(0);
    });

    test("aborting while the credential is being resolved rejects with the reason, and registers nothing", async () => {
        const gate = deferred<string>();
        const { db, engine, fake } = await connectFor(perRequest(() => gate.promise));
        const errors: Error[] = [];

        db.subscribe("error", (error) => errors.push(error));

        const controller = new AbortController();
        const reason = new Error("the request went away");
        const registering = caught(Promise.resolve(db.withSignal(controller.signal).live(person)));

        await flush();
        controller.abort(reason);

        const started = performance.now();

        expect(await registering).toBe(reason);
        expect(performance.now() - started).toBeLessThan(1000);

        // What the resolver comes up with later is for the requests which follow, and a request
        // which is gone does not send a registration with it
        gate.resolve("late-token");
        await flush();
        await Bun.sleep(5);

        expect(registrations(engine)).toHaveLength(0);
        expect(fake.log.registered).toBe(0);
        expect(fake.log.kills).toEqual([]);

        // Giving up is not a failure of the connection, and there is nothing to tell the server
        expect(errors).toEqual([]);
    });

    test("a registration which is queued behind another credential does not ask for one once abandoned", async () => {
        const first = deferred<string>();
        let resolved = 0;
        const { db, engine, fake } = await connectFor(
            perRequest(() => (++resolved === 1 ? first.promise : "second-token")),
        );
        const waiting = caught(
            Promise.resolve(db.query("RETURN 1").signal(AbortSignal.timeout(30))),
        );

        await until(() => resolved === 1);

        // This is queued behind the first, which is still being resolved
        const controller = new AbortController();
        const reason = new Error("the request went away");
        const queued = caught(Promise.resolve(db.withSignal(controller.signal).live(person)));

        await flush();
        controller.abort(reason);

        expect(await queued).toBe(reason);
        expect(((await waiting) as Error).name).toBe("TimeoutError");

        first.resolve("first-token");
        await until(() => methods(engine).includes("authenticate"));
        await flush();

        // Only the first was asked for a credential, and no live query was registered
        expect(resolved).toBe(1);
        expect(registrations(engine)).toHaveLength(0);
        expect(fake.log.registered).toBe(0);
    });

    test("a request on its way is not abandoned: the live query it registers is killed when it lands", async () => {
        const { db, engine, fake } = await connectFor(perRequest(() => "session-token"));
        const controller = new AbortController();
        const reason = new Error("the request went away");
        let land: () => void = () => {};

        engine.respond = async (request) => {
            const text = String(request.params?.[0] ?? "");

            if (request.method === "query" && text.includes("LIVE SELECT")) {
                fake.log.registered++;

                return new Promise((resolve) => {
                    land = () =>
                        resolve([{ status: "OK", time: "1ms", result: fake.id, type: "live" }]);
                });
            }

            return request.method === "query" ? fake.answer(text) : ok();
        };

        const registering = caught(Promise.resolve(db.withSignal(controller.signal).live(person)));

        await until(() => registrations(engine).length === 1);
        controller.abort(reason);

        expect(await registering).toBe(reason);

        // The engine was not told to give up on it, which would drop the answer which says what
        // was registered, and with it the only way to end it
        const { options } = registrations(engine)[0];

        expect(options?.signal).toBeUndefined();
        expect(options).not.toHaveProperty("beforeSend");

        land();
        await until(() => fake.log.kills.length === 1);

        expect(fake.log.kills[0]).toContain(fake.id.toString());
    });

    test("a request which is not made on a scope is sent as it was", async () => {
        const { db, engine } = await connectFor(perRequest(() => "session-token"));

        await db.live(person);

        const [registration] = registrations(engine);

        expect(registration.options).toBeUndefined();
    });

    test("a live query is not made as someone else", async () => {
        const { db } = await connectFor(perRequest(() => "session-token"));
        const scoped = db.withSignal(new AbortController().signal);

        // There is no .as() on a live query: it is registered on the session, and killed as it
        expect("as" in scoped.live(person)).toBe(false);
        expect("as" in scoped.liveOf(Uuid.v4())).toBe(false);
        expect("as" in db.live(person)).toBe(false);
    });
});

describe("a live subscription, while the credentials resolved for each request change", () => {
    test("is neither killed nor leaked when each request resolves a credential of its own", async () => {
        let resolved = 0;
        const { db, engine, fake } = await connectFor(perRequest(() => `token-${++resolved}`));
        const errors: Error[] = [];

        db.subscribe("error", (error) => errors.push(error));

        const controller = new AbortController();
        const subscription = await db.withSignal(controller.signal).live(person);
        const seen: LiveMessage[] = [];
        const reading = (async () => {
            for await (const message of subscription) seen.push(message);
        })();

        fake.notify(1);
        await flush();

        // Other requests are made as the credentials come, and each applies its own to the session
        await db.query("RETURN 1");
        await db.query("RETURN 2");
        fake.notify(2);
        await flush();

        expect(resolved).toBeGreaterThan(1);
        expect(
            methods(engine).filter((method) => method === "authenticate").length,
        ).toBeGreaterThan(1);
        expect(subscription.isAlive).toBe(true);
        expect(fake.log.kills).toEqual([]);
        expect(fake.log.cleaned).toBe(0);
        expect(seen.map((message) => message.action)).toEqual(["CREATE", "CREATE"]);
        expect(errors).toEqual([]);

        // It ends only when its signal says so, once, and what it held is let go of
        controller.abort();
        await reading;
        await until(() => fake.log.kills.length === 1);

        expect(fake.log.cleaned).toBe(1);
        expect(errors).toEqual([]);
    });

    test("is neither killed nor leaked when a credential which expired is resolved again", async () => {
        clock = new FakeClock(new Date("2030-01-01T00:00:00Z")).install();

        const fake = newServer();
        let resolved = 0;
        const { db, engine } = await connectSession(
            (request) => {
                if (request.method === "query") return fake.answer(String(request.params?.[0]));
                return serve()(request);
            },
            perRequest(() => createJwtExpiringIn(300, `token-${++resolved}`), "until-expiry"),
        );

        open = db;
        engine.features.add(Features.LiveQueries);
        engine.liveQuery = fake.liveImpl as never;

        const errors: Error[] = [];

        db.subscribe("error", (error) => errors.push(error));

        const controller = new AbortController();
        const subscription = await db.withSignal(controller.signal).live(person);
        const seen: LiveMessage[] = [];
        const reading = (async () => {
            for await (const message of subscription) seen.push(message);
        })();

        // Reused for as long as it lives
        await db.query("RETURN 1");
        expect(resolved).toBe(1);

        fake.notify(1);
        await flush();

        // Long after the token expired, the next request needs a new one, which the session takes
        await clock.advance(10 * 60_000, flush);
        await db.query("RETURN 2");

        expect(resolved).toBe(2);
        expect(engine.methods().filter((method) => method === "authenticate")).toHaveLength(2);
        expect(subscription.isAlive).toBe(true);
        expect(fake.log.kills).toEqual([]);
        expect(fake.log.cleaned).toBe(0);

        fake.notify(2);
        await flush();

        expect(seen.map((message) => message.action)).toEqual(["CREATE", "CREATE"]);
        expect(errors).toEqual([]);

        // Nothing was scheduled to renew it in the background, and nothing is left behind
        expect(clock.timers).toBe(0);

        controller.abort();
        await reading;
        await flush();

        expect(fake.log.kills).toHaveLength(1);
        expect(fake.log.cleaned).toBe(1);
        expect(errors).toEqual([]);
    });

    test("is registered again after a reconnection, with the credential which is resolved for it", async () => {
        const fake = newServer();
        let resolved = 0;
        const { db, engine } = await connectSession(
            (request) => {
                if (request.method === "query") return fake.answer(String(request.params?.[0]));
                return serve()(request);
            },
            perRequest(() => `token-${++resolved}`),
        );

        open = db;
        engine.features.add(Features.LiveQueries);
        engine.liveQuery = fake.liveImpl as never;

        const controller = new AbortController();
        const subscription = await db.withSignal(controller.signal).live(person);

        expect(fake.log.registered).toBe(1);

        engine.reconnect();
        await until(() => fake.log.registered === 2);

        // The session of the new connection was authenticated again before the live query was
        const sent = engine.methods();

        expect(sent.lastIndexOf("authenticate")).toBeLessThan(sent.lastIndexOf("query"));
        expect(subscription.isAlive).toBe(true);

        controller.abort();
        await until(() => fake.log.kills.length >= 1);

        expect(subscription.isAlive).toBe(false);
    });
});
