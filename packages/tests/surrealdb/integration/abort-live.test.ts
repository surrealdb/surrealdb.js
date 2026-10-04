import { describe, expect, test } from "bun:test";
import { type LiveMessage, RecordId, type Surreal, Table, type Uuid } from "surrealdb";
import { createSurreal, SURREAL_PROTOCOL } from "./__helpers__";

const person = new Table("person");

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

async function setup() {
    const surreal = await createSurreal();
    await surreal.query(/* surql */ `DEFINE TABLE person SCHEMALESS`);

    return surreal;
}

// Live queries need a connection which stays open: WebSocket, and not HTTP
describe.if(SURREAL_PROTOCOL === "ws")("live() on a request scope", () => {
    test("aborting kills the live query on the server, and iteration ends cleanly", async () => {
        const surreal = await setup();
        const controller = new AbortController();
        const subscription = await surreal
            .withSignal(controller.signal)
            .live<{ n: number }>(person);

        expect(subscription.isAlive).toBe(true);
        expect(await lives(surreal)).toHaveLength(1);

        const received: LiveMessage[] = [];
        const reading = (async () => {
            for await (const message of subscription) received.push(message);
        })();

        await surreal.create(new RecordId("person", 1)).content({ n: 1 });
        await Bun.sleep(100);
        expect(received.map((message) => message.action)).toEqual(["CREATE"]);

        controller.abort(new Error("the request went away"));

        // Ends without throwing the reason: aborting is how a live stream is meant to end
        await reading;
        expect(subscription.isAlive).toBe(false);

        // Gone from the server too, which is what stops it leaking
        await Bun.sleep(100);
        expect(await lives(surreal)).toEqual([]);

        // And the connection is none the worse for it
        await surreal.create(new RecordId("person", 2)).content({ n: 2 });
        expect(received).toHaveLength(1);
        expect(await surreal.query("RETURN 1").collect()).toEqual([1]);
    });

    test("a signal which has aborted already registers no live query", async () => {
        const surreal = await setup();
        const reason = new Error("the request is already gone");
        const controller = new AbortController();
        controller.abort(reason);

        expect(
            await caught(Promise.resolve(surreal.withSignal(controller.signal).live(person))),
        ).toBe(reason);
        expect(await lives(surreal)).toEqual([]);
    });

    test("however the race between registering and aborting falls, nothing is left on the server", async () => {
        const surreal = await setup();
        const outcomes = { subscribed: 0, rejected: 0 };

        // Aborts at every moment from before the request is sent to after it has been answered
        for (let delay = 0; delay < 30; delay++) {
            const controller = new AbortController();
            const registering = Promise.resolve(
                surreal.withSignal(controller.signal).live(person),
            ).then(
                () => outcomes.subscribed++,
                () => outcomes.rejected++,
            );

            await Bun.sleep(delay % 4);
            controller.abort(new Error("the request went away"));
            await registering;
        }

        // The server may have registered some of them after the caller was told it had been
        // abandoned: those are killed as they land
        await Bun.sleep(300);

        expect(outcomes.subscribed + outcomes.rejected).toBe(30);
        expect(await lives(surreal)).toEqual([]);
    });

    test("killing it afterwards is fine, and a subscription which is not aborted is untouched", async () => {
        const surreal = await setup();
        const gone = new AbortController();
        const staying = new AbortController();

        const doomed = await surreal.withSignal(gone.signal).live(person);
        const kept = await surreal.withSignal(staying.signal).live(person);
        const plain = await surreal.live(person);

        expect(await lives(surreal)).toHaveLength(3);

        gone.abort();
        await Bun.sleep(100);

        await doomed.kill();
        expect(await lives(surreal)).toHaveLength(2);
        expect(kept.isAlive).toBe(true);
        expect(plain.isAlive).toBe(true);

        await kept.kill();
        await plain.kill();
        expect(await lives(surreal)).toEqual([]);
    });

    test("holds on to no listener on the signal once it has ended", async () => {
        const surreal = await setup();
        const controller = new AbortController();
        const { signal } = controller;
        let held = 0;
        const add = signal.addEventListener.bind(signal);
        const remove = signal.removeEventListener.bind(signal);

        signal.addEventListener = ((...args: Parameters<typeof add>) => {
            if (typeof args[2] === "object" && args[2]?.once) held++;
            return add(...args);
        }) as typeof add;
        signal.removeEventListener = ((...args: Parameters<typeof remove>) => {
            held--;
            return remove(...args);
        }) as typeof remove;

        const first = await surreal.withSignal(signal).live(person);
        expect(held).toBe(1);

        await first.kill();
        expect(held).toBe(0);

        await surreal.withSignal(signal).live(person);
        controller.abort();
        await Bun.sleep(100);

        // `once` listeners remove themselves when they fire, which the count above does not see
        expect(held).toBeLessThanOrEqual(1);
        expect(await lives(surreal)).toEqual([]);
    });

    test("an SSE style handler streams changes until the client goes away, and leaves nothing behind", async () => {
        const surreal = await setup();
        const encoder = new TextEncoder();
        const decoder = new TextDecoder();

        // What a route handler does: bind the work to the request, and stream until it ends
        const handler = async (request: { signal: AbortSignal }) => {
            const subscription = await surreal
                .withSignal(request.signal)
                .live<{ n: number }>(person);

            return new Response(
                new ReadableStream({
                    async start(controller) {
                        for await (const message of subscription) {
                            controller.enqueue(
                                encoder.encode(`data: ${message.action} ${message.recordId}\n\n`),
                            );
                        }

                        controller.close();
                    },
                }),
                { headers: { "Content-Type": "text/event-stream" } },
            );
        };

        const client = new AbortController();
        const response = await handler({ signal: client.signal });
        const reader = (response.body as ReadableStream<Uint8Array>).getReader();

        expect(await lives(surreal)).toHaveLength(1);

        await surreal.create(new RecordId("person", 1)).content({ n: 1 });
        expect(decoder.decode((await reader.read()).value)).toBe("data: CREATE person:1\n\n");

        await surreal.create(new RecordId("person", 2)).content({ n: 2 });
        expect(decoder.decode((await reader.read()).value)).toBe("data: CREATE person:2\n\n");

        // The client disconnects
        client.abort();

        expect((await reader.read()).done).toBe(true);
        await Bun.sleep(100);
        expect(await lives(surreal)).toEqual([]);
    });

    test("many handlers come and go, and the ones which stay keep their changes", async () => {
        const surreal = await setup();
        const controllers = Array.from({ length: 10 }, () => new AbortController());
        const received = controllers.map(() => [] as LiveMessage[]);

        const subscriptions = await Promise.all(
            controllers.map((controller) => surreal.withSignal(controller.signal).live(person)),
        );

        subscriptions.forEach((subscription, index) => {
            subscription.subscribe((message) => received[index]?.push(message));
        });

        expect(await lives(surreal)).toHaveLength(10);

        // Half the requests go away
        for (const controller of controllers.slice(0, 5)) controller.abort();
        await Bun.sleep(150);

        expect(await lives(surreal)).toHaveLength(5);

        await surreal.create(new RecordId("person", 1)).content({ n: 1 });
        await Bun.sleep(150);

        expect(received.slice(0, 5).map((messages) => messages.length)).toEqual([0, 0, 0, 0, 0]);
        expect(received.slice(5).map((messages) => messages.length)).toEqual([1, 1, 1, 1, 1]);

        for (const controller of controllers.slice(5)) controller.abort();
        await Bun.sleep(150);
        expect(await lives(surreal)).toEqual([]);
    });
});

describe.if(SURREAL_PROTOCOL === "ws")("liveOf() on a request scope", () => {
    test("aborting kills the live query on the server", async () => {
        const surreal = await setup();
        const [liveId] = await surreal.query("LIVE SELECT * FROM person").collect<[Uuid]>();
        const controller = new AbortController();
        const subscription = await surreal.withSignal(controller.signal).liveOf(liveId as Uuid);

        expect(await lives(surreal)).toHaveLength(1);

        const reading = (async () => {
            for await (const _ of subscription) {
                // Nothing is written here
            }
        })();

        controller.abort();
        await reading;

        expect(subscription.isAlive).toBe(false);
        await Bun.sleep(100);
        expect(await lives(surreal)).toEqual([]);
    });

    test("a signal which has aborted already leaves the live query alone", async () => {
        const surreal = await setup();
        const [liveId] = await surreal.query("LIVE SELECT * FROM person").collect<[Uuid]>();
        const reason = new Error("the request is already gone");
        const controller = new AbortController();
        controller.abort(reason);

        expect(
            await caught(
                Promise.resolve(surreal.withSignal(controller.signal).liveOf(liveId as Uuid)),
            ),
        ).toBe(reason);

        // It was not this call's to kill: it was never subscribed to
        expect(await lives(surreal)).toHaveLength(1);
    });
});
