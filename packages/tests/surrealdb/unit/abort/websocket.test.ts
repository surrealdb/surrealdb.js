import { afterEach, describe, expect, test } from "bun:test";
import { BoundQuery, CallTerminatedError, WebSocketEngine } from "surrealdb";
import { type MockRequest, MockSocket, mockContext, mockState } from "../__helpers__/mock-socket";

let engine: WebSocketEngine | undefined;

afterEach(async () => {
    await engine?.close();
    engine = undefined;
    MockSocket.reset();
});

/** Opens an engine against the mocked socket and waits until it is connected. */
async function openEngine<E extends WebSocketEngine = WebSocketEngine>(
    options: { reconnect?: boolean; create?: (context: ReturnType<typeof mockContext>) => E } = {},
): Promise<E> {
    const context = mockContext();
    const opened = (options.create?.(context) ?? new WebSocketEngine(context)) as E;

    engine = opened;

    const connected = new Promise<void>((resolve) => {
        const unsubscribe = opened.subscribe("connected", () => {
            unsubscribe();
            resolve();
        });
    });

    opened.open(mockState(options.reconnect ?? false));

    await connected;

    return opened;
}

async function caught(promise: Promise<unknown>): Promise<unknown> {
    try {
        await promise;
    } catch (error) {
        return error;
    }

    throw new Error("Expected the promise to reject");
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

/** The ids the engine has sent, in order, for one method. */
function ids(socket: MockSocket, method: string): string[] {
    return socket.requestsFor(method).map((request) => request.id);
}

describe("websocket engine signals", () => {
    test("a request which is not aborted is answered as before", async () => {
        const controller = new AbortController();
        const opened = await openEngine();

        MockSocket.handler = (socket, request) => {
            queueMicrotask(() => socket.respond({ id: request.id, result: "surrealdb-3.0.0" }));
        };

        expect(
            (await opened.send({ method: "version" }, { signal: controller.signal })) as unknown,
        ).toBe("surrealdb-3.0.0");
    });

    test("a signal which has aborted already rejects with the reason and sends nothing", async () => {
        const controller = new AbortController();
        const reason = new Error("client went away");
        controller.abort(reason);
        const opened = await openEngine();

        expect(
            await caught(opened.send({ method: "version" }, { signal: controller.signal })),
        ).toBe(reason);
        expect(MockSocket.current.requests).toEqual([]);
    });

    test("a query which has aborted already is not sent either", async () => {
        const controller = new AbortController();
        controller.abort(new Error("client went away"));
        const opened = await openEngine();

        await expect(
            (async () => {
                for await (const _ of opened.query(
                    new BoundQuery("RETURN 1"),
                    undefined,
                    undefined,
                    {
                        signal: controller.signal,
                    },
                )) {
                    // Nothing to read
                }
            })(),
        ).rejects.toThrow("client went away");
        expect(MockSocket.current.requests).toEqual([]);
    });

    test("aborting mid flight rejects with the reason, whatever it is", async () => {
        const opened = await openEngine();

        for (const reason of [
            new DOMException("The operation was aborted.", "AbortError"),
            new DOMException("The operation timed out.", "TimeoutError"),
            new Error("custom"),
        ]) {
            const controller = new AbortController();
            const sending = opened.send({ method: "version" }, { signal: controller.signal });

            await Bun.sleep(1);
            controller.abort(reason);

            expect(await caught(sending)).toBe(reason);
        }

        // Each was sent: nothing is withheld, only the waiting is given up
        expect(MockSocket.current.requestsFor("version")).toHaveLength(3);
    });

    test("a read of a query in flight ends with the reason", async () => {
        const controller = new AbortController();
        const reason = new Error("client went away");
        const opened = await openEngine();

        const reading = (async () => {
            for await (const _ of opened.query(
                new BoundQuery("SELECT * FROM slow"),
                undefined,
                undefined,
                {
                    signal: controller.signal,
                },
            )) {
                // Nothing is ever answered
            }
        })();

        await Bun.sleep(1);
        controller.abort(reason);

        expect(await caught(reading)).toBe(reason);
        expect(MockSocket.current.requestsFor("query")).toHaveLength(1);
    });

    test("an aborted call is forgotten: nothing is left pending to be sent again", async () => {
        const opened = await openEngine();
        const controller = new AbortController();

        // One call which stays pending, and one which is abandoned
        const kept = opened.send({ method: "version" });
        const abandoned = opened.send({ method: "health" }, { signal: controller.signal });
        kept.catch(() => {});

        const socket = MockSocket.current;

        // Control: asked to send what is pending, the engine sends both
        opened.ready();
        expect(ids(socket, "version")).toHaveLength(2);
        expect(ids(socket, "health")).toHaveLength(2);

        controller.abort(new Error("client went away"));
        await caught(abandoned);

        opened.ready();

        expect(ids(socket, "version")).toHaveLength(3);
        expect(ids(socket, "health")).toHaveLength(2);
    });

    test("a response arriving after the abort is ignored", async () => {
        const opened = await openEngine();
        const controller = new AbortController();
        const errors: Error[] = [];

        opened.subscribe("error", (error) => errors.push(error));

        const sending = opened.send({ method: "version" }, { signal: controller.signal });

        await Bun.sleep(1);
        controller.abort(new Error("client went away"));
        await caught(sending);

        const [request] = MockSocket.current.requestsFor("version") as [MockRequest];

        // The answer, and then a failure for the same id, as a server which carried on might send
        MockSocket.current.respond({ id: request.id, result: "surrealdb-3.0.0" });
        MockSocket.current.respond({ id: request.id, error: { code: -32000, message: "late" } });
        await Bun.sleep(5);

        expect(errors).toEqual([]);

        // And the connection is as good as it was
        MockSocket.handler = (socket, next) => {
            queueMicrotask(() => socket.respond({ id: next.id, result: "still working" }));
        };

        expect((await opened.send({ method: "health" })) as unknown).toBe("still working");
    });

    test("a late response does not disturb the call which came after it", async () => {
        const opened = await openEngine();
        const controller = new AbortController();

        const first = opened.send({ method: "version" }, { signal: controller.signal });
        await Bun.sleep(1);
        controller.abort(new Error("client went away"));
        await caught(first);

        const second = opened.send({ method: "health" });
        const [early] = MockSocket.current.requestsFor("version") as [MockRequest];
        const [later] = MockSocket.current.requestsFor("health") as [MockRequest];

        MockSocket.current.respond({ id: early.id, result: "meant for the first" });
        MockSocket.current.respond({ id: later.id, result: "meant for the second" });

        expect(await second).toBe("meant for the second");
    });

    test("signals are not held on to once a call has ended, however it ended", async () => {
        const opened = await openEngine();
        const controller = new AbortController();
        const spy = spyOnListeners(controller.signal);

        MockSocket.handler = (socket, request) => {
            if (request.method === "version") {
                queueMicrotask(() => socket.respond({ id: request.id, result: "ok" }));
            }

            if (request.method === "health") {
                queueMicrotask(() =>
                    socket.respond({ id: request.id, error: { code: -32000, message: "failed" } }),
                );
            }
        };

        // Answered
        await opened.send({ method: "version" }, { signal: controller.signal });
        expect(spy.held).toBe(0);

        // Failed
        await caught(opened.send({ method: "health" }, { signal: controller.signal }));
        expect(spy.held).toBe(0);

        // Abandoned
        const hanging = new AbortController();
        const hangingSpy = spyOnListeners(hanging.signal);
        const abandoned = opened.send({ method: "ping" }, { signal: hanging.signal });

        expect(hangingSpy.held).toBe(1);
        hanging.abort();
        await caught(abandoned);
        expect(hangingSpy.held).toBe(0);
    });

    test("signals are released when the connection takes the call down", async () => {
        const opened = await openEngine({ reconnect: false });
        const controller = new AbortController();
        const spy = spyOnListeners(controller.signal);

        const sending = opened.send({ method: "version" }, { signal: controller.signal });

        await Bun.sleep(1);
        expect(spy.held).toBe(1);

        MockSocket.current.close();

        expect(await caught(sending)).toBeInstanceOf(CallTerminatedError);
        expect(spy.held).toBe(0);
    });

    test("a request which could not be written leaves nothing registered", async () => {
        const opened = await openEngine();
        const controller = new AbortController();
        const spy = spyOnListeners(controller.signal);

        // A value which cannot be encoded: it refers to itself
        const circular: Record<string, unknown> = {};
        circular.self = circular;

        await expect(
            opened.send({ method: "query", params: [circular] }, { signal: controller.signal }),
        ).rejects.toThrow();

        expect(spy.held).toBe(0);

        opened.ready();
        expect(MockSocket.current.requests).toEqual([]);
    });

    test("an abandoned call is announced to the hook for engines which can cancel", async () => {
        class Cancelling extends WebSocketEngine {
            readonly abandoned: { id: string; request: object }[] = [];

            protected override abandon(id: string, request: object): void {
                this.abandoned.push({ id, request });
            }
        }

        const opened = await openEngine({ create: (context) => new Cancelling(context) });
        const controller = new AbortController();

        MockSocket.handler = (socket, request) => {
            if (request.method === "health") {
                queueMicrotask(() => socket.respond({ id: request.id, result: null }));
            }
        };

        // Answered normally: not abandoned
        await opened.send({ method: "health" }, { signal: controller.signal });
        expect(opened.abandoned).toEqual([]);

        const sending = opened.send({ method: "version" }, { signal: controller.signal });

        await Bun.sleep(1);
        controller.abort(new Error("client went away"));
        await caught(sending);

        const [sent] = MockSocket.current.requestsFor("version") as [MockRequest];

        expect(opened.abandoned).toHaveLength(1);
        expect(opened.abandoned[0]?.id).toBe(sent.id);
        expect(opened.abandoned[0]?.request).toMatchObject({ id: sent.id, method: "version" });
    });

    test("an abandon hook which throws does not leave the caller waiting", async () => {
        class Failing extends WebSocketEngine {
            protected override abandon(): void {
                throw new Error("could not cancel");
            }
        }

        const opened = await openEngine({ create: (context) => new Failing(context) });
        const controller = new AbortController();
        const reason = new Error("client went away");
        const sending = opened.send({ method: "version" }, { signal: controller.signal });

        await Bun.sleep(1);
        controller.abort(reason);

        expect(await caught(sending)).toBe(reason);
    });
});
