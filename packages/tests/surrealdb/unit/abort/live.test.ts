import { afterEach, describe, expect, test } from "bun:test";
import {
    CallTerminatedError,
    ChannelIterator,
    ConnectionUnavailableError,
    type LiveMessage,
    LiveSubscriptionError,
    RecordId,
    ServerError,
    type Surreal,
    Table,
    Uuid,
} from "surrealdb";
import { connectFake, type FakeEngine } from "../__helpers__/mock-engine";

const person = new Table("person");

let open: Surreal | undefined;

afterEach(async () => {
    await open?.close();
    open = undefined;
});

async function connect() {
    const connected = await connectFake();
    open = connected.db;
    return connected;
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

/**
 * A fake server which registers live queries and notes what it was asked, and a channel for the
 * notifications of the live query it hands out.
 */
function server(engine: FakeEngine) {
    const id = Uuid.v4();
    const log = { registered: 0, kills: [] as string[], cleaned: 0 };
    const channels: ChannelIterator<LiveMessage>[] = [];

    // Every subscription is handed a channel of its own, as an engine does
    engine.liveImpl = () => {
        const channel = new ChannelIterator<LiveMessage>(() => {
            log.cleaned++;
        });

        channels.push(channel);

        return channel;
    };
    engine.respond = async (request) => {
        const text = String(request.params?.[0] ?? "");

        if (text.includes("KILL")) {
            log.kills.push(text);
            return ok();
        }

        if (text.includes("LIVE SELECT")) {
            log.registered++;
            return [{ status: "OK", time: "1ms", result: id, type: "live" }];
        }

        return ok();
    };

    const notify = (n: number) => {
        for (const channel of channels) {
            channel.submit({
                queryId: id,
                action: "CREATE",
                recordId: new RecordId("person", n),
                value: { n },
            });
        }
    };

    return {
        id,
        log,
        get channel() {
            return channels[channels.length - 1] as ChannelIterator<LiveMessage>;
        },
        notify,
    };
}

/** Counts the listeners a signal is holding, to tell whether something let go of it. */
function spyOnListeners(signal: AbortSignal) {
    const live = new Set<unknown>();
    const wrapped = new Map<unknown, EventListenerOrEventListenerObject>();
    const add = signal.addEventListener.bind(signal);
    const remove = signal.removeEventListener.bind(signal);

    signal.addEventListener = ((
        type: string,
        listener: EventListener,
        options?: AddEventListenerOptions | boolean,
    ) => {
        live.add(listener);

        if (typeof options === "object" && options.once) {
            const once: EventListener = (event) => {
                live.delete(listener);
                listener(event);
            };

            wrapped.set(listener, once);
            return add(type, once, options);
        }

        return add(type, listener, options);
    }) as typeof add;

    signal.removeEventListener = ((type: string, listener: EventListener, options?: unknown) => {
        live.delete(listener);
        return remove(type, wrapped.get(listener) ?? listener, options as never);
    }) as typeof remove;

    return {
        get held() {
            return live.size;
        },
    };
}

/** Reads a subscription to its end, collecting what it delivers. */
async function drain(subscription: AsyncIterable<LiveMessage>): Promise<LiveMessage[]> {
    const messages: LiveMessage[] = [];

    for await (const message of subscription) {
        messages.push(message);
    }

    return messages;
}

describe("live() on a request scope", () => {
    test("a subscription made without a scope is unaffected, and holds on to no signal", async () => {
        const { db, engine } = await connect();
        const fake = server(engine);
        const subscription = await db.live(person);

        fake.notify(1);
        await Bun.sleep(1);

        expect(subscription.isAlive).toBe(true);
        expect(fake.log.kills).toEqual([]);

        // A scope made and aborted elsewhere changes nothing about it
        const controller = new AbortController();
        db.withSignal(controller.signal);
        controller.abort();
        await Bun.sleep(1);

        expect(subscription.isAlive).toBe(true);
        expect(fake.log.kills).toEqual([]);
    });

    test("is killed when the signal aborts: iteration ends cleanly, isAlive is false, the server is told", async () => {
        const { db, engine } = await connect();
        const fake = server(engine);
        const controller = new AbortController();
        const subscription = await db.withSignal(controller.signal).live(person);

        expect(subscription.isAlive).toBe(true);
        expect(subscription.isManaged).toBe(true);

        const reading = drain(subscription);
        fake.notify(1);
        await Bun.sleep(1);
        fake.notify(2);
        await Bun.sleep(1);

        controller.abort(new Error("the request went away"));

        // Cleanly, with what had been delivered, and without throwing the reason
        const messages = await reading;

        expect(messages.map((message) => message.action)).toEqual(["CREATE", "CREATE"]);
        expect(subscription.isAlive).toBe(false);

        await Bun.sleep(1);

        expect(fake.log.kills).toHaveLength(1);
        expect(fake.log.kills[0]).toContain(fake.id.toString());
    });

    test("isAlive is false the moment it aborts, before the server has answered the kill", async () => {
        const { db, engine } = await connect();
        const fake = server(engine);
        const controller = new AbortController();
        const subscription = await db.withSignal(controller.signal).live(person);
        let release: () => void = () => {};

        engine.respond = (request) => {
            if (String(request.params?.[0]).includes("KILL")) {
                return new Promise((resolve) => {
                    release = () => resolve(ok());
                });
            }

            return Promise.resolve(ok());
        };

        controller.abort();

        expect(subscription.isAlive).toBe(false);
        expect(fake.log.cleaned).toBe(1);

        release();
    });

    test("the engine is let go of the notifications, whatever the server does about the kill", async () => {
        const { db, engine } = await connect();
        const fake = server(engine);
        const controller = new AbortController();

        await db.withSignal(controller.signal).live(person);
        expect(fake.log.cleaned).toBe(0);

        controller.abort();
        await Bun.sleep(1);

        // A server which never announces the end of a killed live query would otherwise leave this
        // held for the life of the connection
        expect(fake.log.cleaned).toBe(1);
    });

    test("a signal which has aborted already registers no live query at all", async () => {
        const { db, engine } = await connect();
        const fake = server(engine);
        const reason = new Error("the request is already gone");
        const controller = new AbortController();
        controller.abort(reason);

        expect(await caught(Promise.resolve(db.withSignal(controller.signal).live(person)))).toBe(
            reason,
        );
        expect(fake.log.registered).toBe(0);
        expect(engine.sent).toEqual([]);
    });

    test("a signal which aborts while the live query is being registered ends it as soon as it lands", async () => {
        const { db, engine } = await connect();
        const fake = server(engine);
        const controller = new AbortController();
        const reason = new Error("the request went away");
        let register: () => void = () => {};

        engine.respond = (request) => {
            const text = String(request.params?.[0] ?? "");

            if (text.includes("KILL")) {
                fake.log.kills.push(text);
                return Promise.resolve(ok());
            }

            fake.log.registered++;

            return new Promise((resolve) => {
                register = () =>
                    resolve([{ status: "OK", time: "1ms", result: fake.id, type: "live" }]);
            });
        };

        const started = performance.now();
        const registering = Promise.resolve(db.withSignal(controller.signal).live(person));

        await Bun.sleep(5);
        controller.abort(reason);

        // The caller is told at once
        expect(await caught(registering)).toBe(reason);
        expect(performance.now() - started).toBeLessThan(1000);
        expect(fake.log.kills).toEqual([]);

        // The server registers it anyway, and the live query nobody listens to is killed
        register();
        await Bun.sleep(10);

        expect(fake.log.kills).toHaveLength(1);
        expect(fake.log.kills[0]).toContain(fake.id.toString());
    });

    test("killing it again, after the signal aborted, is a no-op and does not fail", async () => {
        const { db, engine } = await connect();
        const fake = server(engine);
        const controller = new AbortController();
        const subscription = await db.withSignal(controller.signal).live(person);

        controller.abort();
        await Bun.sleep(1);

        await subscription.kill();
        await subscription.kill();

        expect(fake.log.kills).toHaveLength(1);
    });

    test("aborting after it was killed does not kill it a second time", async () => {
        const { db, engine } = await connect();
        const fake = server(engine);
        const controller = new AbortController();
        const subscription = await db.withSignal(controller.signal).live(person);

        await subscription.kill();
        controller.abort();
        await Bun.sleep(1);

        expect(fake.log.kills).toHaveLength(1);
    });

    test("signals are not held on to once the subscription has ended, however it ended", async () => {
        const { db, engine } = await connect();
        const fake = server(engine);

        // Killed by hand
        const killed = new AbortController();
        const killedSpy = spyOnListeners(killed.signal);
        const first = await db.withSignal(killed.signal).live(person);
        expect(killedSpy.held).toBe(1);
        await first.kill();
        expect(killedSpy.held).toBe(0);

        // Aborted
        const aborted = new AbortController();
        const abortedSpy = spyOnListeners(aborted.signal);
        await db.withSignal(aborted.signal).live(person);
        expect(abortedSpy.held).toBe(1);
        aborted.abort();
        await Bun.sleep(1);
        expect(abortedSpy.held).toBe(0);

        // Ended by the server
        const served = new AbortController();
        const servedSpy = spyOnListeners(served.signal);
        const third = await db.withSignal(served.signal).live(person);
        expect(servedSpy.held).toBe(1);
        const reading = drain(third);
        fake.channel.submit({ queryId: fake.id, action: "KILLED" });
        await reading;
        expect(servedSpy.held).toBe(0);
    });

    test("a signal is not held on to when the registration fails", async () => {
        const { db, engine } = await connect();
        const controller = new AbortController();
        const spy = spyOnListeners(controller.signal);

        engine.respond = async () => {
            throw new Error("the server refused");
        };

        const error = await caught(Promise.resolve(db.withSignal(controller.signal).live(person)));

        expect(error).toBeInstanceOf(LiveSubscriptionError);
        expect(spy.held).toBe(0);
    });

    test("a subscription which the server ended is not killed again when the signal aborts", async () => {
        const { db, engine } = await connect();
        const fake = server(engine);
        const controller = new AbortController();
        const subscription = await db.withSignal(controller.signal).live(person);
        const reading = drain(subscription);

        fake.channel.submit({ queryId: fake.id, action: "KILLED" });
        await reading;

        expect(subscription.isAlive).toBe(false);

        controller.abort();
        await Bun.sleep(1);

        expect(fake.log.kills).toEqual([]);
    });

    test("every consumer of the subscription ends cleanly, and subscribe() handlers stop", async () => {
        const { db, engine } = await connect();
        const fake = server(engine);
        const controller = new AbortController();
        const subscription = await db.withSignal(controller.signal).live(person);
        const handled: LiveMessage[] = [];

        subscription.subscribe((message) => handled.push(message));
        const first = drain(subscription);
        const second = drain(subscription);

        fake.notify(1);
        await Bun.sleep(1);
        controller.abort();

        expect((await first).length).toBe(1);
        expect((await second).length).toBe(1);

        fake.notify(2);
        await Bun.sleep(1);

        expect(handled).toHaveLength(1);
    });

    test("iterating a subscription which has been aborted is refused, as after a kill", async () => {
        const { db, engine } = await connect();
        server(engine);
        const controller = new AbortController();
        const subscription = await db.withSignal(controller.signal).live(person);

        controller.abort();
        await Bun.sleep(1);

        expect(() => subscription[Symbol.asyncIterator]()).toThrow(LiveSubscriptionError);
    });

    test("signals combine: either one kills it", async () => {
        const { db, engine } = await connect();
        server(engine);
        const request = new AbortController();
        const other = new AbortController();

        const first = await db.withSignal(request.signal).withSignal(other.signal).live(person);
        const second = await db.withSignal(request.signal).withSignal(other.signal).live(person);

        other.abort();
        await Bun.sleep(1);

        expect(first.isAlive).toBe(false);
        expect(second.isAlive).toBe(false);

        const third = await db.withSignal(new AbortController().signal).live(person);
        expect(third.isAlive).toBe(true);
    });

    test("one request's abort does not touch another request's subscription", async () => {
        const { db, engine } = await connect();
        server(engine);
        const gone = new AbortController();
        const staying = new AbortController();

        const doomed = await db.withSignal(gone.signal).live(person);
        const kept = await db.withSignal(staying.signal).live(person);

        gone.abort();
        await Bun.sleep(1);

        expect(doomed.isAlive).toBe(false);
        expect(kept.isAlive).toBe(true);
    });

    test("a failure to kill is reported on the error channel, but a connection which is gone is not", async () => {
        const { db, engine } = await connect();
        server(engine);
        const errors: Error[] = [];

        db.subscribe("error", (error) => errors.push(error));

        // The server refuses the kill
        const refused = new AbortController();
        await db.withSignal(refused.signal).live(person);
        engine.respond = async () => {
            throw new ServerError({ message: "no such live query", kind: "NotFound" });
        };
        refused.abort();
        await Bun.sleep(5);

        expect(errors).toHaveLength(1);
        expect(errors[0]).toBeInstanceOf(LiveSubscriptionError);

        // The connection is gone: so is the live query, and there is nothing to report
        for (const gone of [new ConnectionUnavailableError(), new CallTerminatedError()]) {
            server(engine);
            const controller = new AbortController();
            await db.withSignal(controller.signal).live(person);
            engine.respond = async () => {
                throw gone;
            };
            controller.abort();
            await Bun.sleep(5);
        }

        expect(errors).toHaveLength(1);
    });
});

describe("liveOf() on a request scope", () => {
    test("is killed when the signal aborts", async () => {
        const { db, engine } = await connect();
        const fake = server(engine);
        const controller = new AbortController();
        const spy = spyOnListeners(controller.signal);
        const subscription = await db.withSignal(controller.signal).liveOf(fake.id);

        expect(subscription.isManaged).toBe(false);
        expect(spy.held).toBe(1);

        const reading = drain(subscription);
        fake.notify(1);
        await Bun.sleep(1);
        controller.abort();

        expect((await reading).length).toBe(1);
        expect(subscription.isAlive).toBe(false);

        await Bun.sleep(1);

        expect(fake.log.kills).toHaveLength(1);
        expect(fake.log.kills[0]).toContain(fake.id.toString());
        expect(fake.log.cleaned).toBe(1);
        expect(spy.held).toBe(0);
    });

    test("a signal which has aborted already subscribes to nothing, and leaves the live query alone", async () => {
        const { db, engine } = await connect();
        const fake = server(engine);
        const reason = new Error("the request is already gone");
        const controller = new AbortController();
        controller.abort(reason);

        expect(
            await caught(Promise.resolve(db.withSignal(controller.signal).liveOf(fake.id))),
        ).toBe(reason);
        expect(fake.log.kills).toEqual([]);
        expect(engine.sent).toEqual([]);
    });

    test("killing it again afterwards is a no-op", async () => {
        const { db, engine } = await connect();
        const fake = server(engine);
        const controller = new AbortController();
        const subscription = await db.withSignal(controller.signal).liveOf(fake.id);

        controller.abort();
        await Bun.sleep(1);
        await subscription.kill();

        expect(fake.log.kills).toHaveLength(1);
    });
});

describe("a server sent events handler", () => {
    // The handler of a route which streams live changes to a browser until it goes away
    function handler(db: Surreal, request: { signal: AbortSignal }) {
        const encoder = new TextEncoder();

        return (async () => {
            const subscription = await db.withSignal(request.signal).live(person);

            return new Response(
                new ReadableStream({
                    async start(controller) {
                        for await (const message of subscription) {
                            controller.enqueue(encoder.encode(`data: ${message.action}\n\n`));
                        }

                        // The client went away, the subscription was killed, and the loop ended
                        controller.close();
                    },
                }),
                { headers: { "Content-Type": "text/event-stream" } },
            );
        })();
    }

    test("streams changes until the client disconnects, and then ends without a trace", async () => {
        const { db, engine } = await connect();
        const fake = server(engine);
        const client = new AbortController();

        const response = await handler(db, { signal: client.signal });
        const reader = (response.body as ReadableStream<Uint8Array>).getReader();
        const decoder = new TextDecoder();

        fake.notify(1);
        expect(decoder.decode((await reader.read()).value)).toBe("data: CREATE\n\n");

        fake.notify(2);
        expect(decoder.decode((await reader.read()).value)).toBe("data: CREATE\n\n");

        client.abort();

        // The stream ends, and the live query is gone from the server
        expect((await reader.read()).done).toBe(true);
        await Bun.sleep(1);
        expect(fake.log.kills).toHaveLength(1);
        expect(fake.log.cleaned).toBe(1);
    });

    test("a client which is gone before the handler subscribes costs the server nothing", async () => {
        const { db, engine } = await connect();
        const fake = server(engine);
        const client = new AbortController();
        client.abort(new Error("gone"));

        await expect(handler(db, { signal: client.signal })).rejects.toThrow("gone");
        expect(fake.log.registered).toBe(0);
    });

    test("many requests come and go without leaving subscriptions behind", async () => {
        const { db, engine } = await connect();
        const fake = server(engine);
        const requests = Array.from({ length: 20 }, () => new AbortController());

        const responses = await Promise.all(
            requests.map((request) => handler(db, { signal: request.signal })),
        );

        expect(fake.log.registered).toBe(20);

        for (const request of requests) request.abort();
        await Promise.all(
            responses.map(async (response) => {
                const reader = (response.body as ReadableStream<Uint8Array>).getReader();
                while (!(await reader.read()).done) {}
            }),
        );
        await Bun.sleep(5);

        expect(fake.log.kills).toHaveLength(20);
    });
});
