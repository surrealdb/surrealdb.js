import { afterEach, describe, expect, test } from "bun:test";
import { CborCodec } from "@surrealdb/sqon";
import { BoundQuery, HttpEngine } from "surrealdb";
import { mockContext, mockState } from "../__helpers__/mock-socket";

const codec = new CborCodec({});

type Fetch = (url: URL | string, init?: RequestInit) => Promise<Response>;

let engine: HttpEngine | undefined;

afterEach(async () => {
    await engine?.close();
    engine = undefined;
});

/** An engine whose requests are answered by the given `fetch`. */
function openEngine(fetchImpl: Fetch, options: { fetchOptions?: object } = {}): HttpEngine {
    const opened = new HttpEngine(
        mockContext({ fetchImpl: fetchImpl as typeof fetch, ...options } as never),
    );

    opened.open(mockState());
    engine = opened;

    return opened;
}

function answer(result: unknown, init?: ResponseInit): Response {
    return new Response(new Uint8Array(codec.encode({ id: "x", result })), init);
}

/** A `fetch` as a runtime provides it, which rejects with the reason when its signal aborts. */
function honouring(response: () => Promise<Response> | Response): Fetch {
    return (_, init) =>
        new Promise<Response>((resolve, reject) => {
            const signal = init?.signal;
            if (signal?.aborted) return reject(signal.reason);
            signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
            Promise.resolve(response()).then(resolve, reject);
        });
}

const never = () => new Promise<Response>(() => {});

async function caught(promise: Promise<unknown>): Promise<unknown> {
    try {
        await promise;
    } catch (error) {
        return error;
    }

    throw new Error("Expected the promise to reject");
}

describe("http engine signals", () => {
    test("a request which is not aborted is answered as before", async () => {
        const controller = new AbortController();
        const opened = openEngine(async () => answer("surrealdb-3.0.0"));

        expect(
            (await opened.send({ method: "version" }, { signal: controller.signal })) as unknown,
        ).toBe("surrealdb-3.0.0");
    });

    test("the signal is handed to fetch", async () => {
        const controller = new AbortController();
        let received: RequestInit | undefined;
        const opened = openEngine(async (_, init) => {
            received = init;
            return answer("surrealdb-3.0.0");
        });

        await opened.send({ method: "version" }, { signal: controller.signal });

        expect(received?.signal).toBe(controller.signal);
    });

    test("a request with no signal hands none to fetch", async () => {
        let received: RequestInit | undefined;
        const opened = openEngine(async (_, init) => {
            received = init;
            return answer("surrealdb-3.0.0");
        });

        await opened.send({ method: "version" });

        expect(received?.signal).toBeUndefined();
    });

    test("a signal which has aborted already rejects with the reason and sends nothing", async () => {
        const controller = new AbortController();
        const reason = new Error("client went away");
        controller.abort(reason);
        let fetched = 0;
        const opened = openEngine(async () => {
            fetched++;
            return answer([]);
        });

        expect(
            await caught(opened.send({ method: "version" }, { signal: controller.signal })),
        ).toBe(reason);
        expect(fetched).toBe(0);
    });

    test("a query which has aborted already is not sent", async () => {
        const controller = new AbortController();
        controller.abort(new Error("client went away"));
        let fetched = 0;
        const opened = openEngine(async () => {
            fetched++;
            return answer([]);
        });

        const chunks = opened.query(new BoundQuery("RETURN 1"), undefined, undefined, {
            signal: controller.signal,
        });

        await expect(
            (async () => {
                for await (const _ of chunks) {
                    // Nothing to read
                }
            })(),
        ).rejects.toThrow("client went away");
        expect(fetched).toBe(0);
    });

    test("aborting mid flight rejects with the reason, as AbortError and TimeoutError alike", async () => {
        const opened = openEngine(honouring(never));

        for (const reason of [
            new DOMException("The operation was aborted.", "AbortError"),
            new DOMException("The operation timed out.", "TimeoutError"),
            new Error("custom"),
        ]) {
            const controller = new AbortController();
            const sending = opened.send({ method: "version" }, { signal: controller.signal });

            setTimeout(() => controller.abort(reason), 5);

            expect(await caught(sending)).toBe(reason);
        }
    });

    test("aborting does not wait for a fetch which ignores signals", async () => {
        const controller = new AbortController();
        const reason = new Error("client went away");
        const started = performance.now();
        const opened = openEngine(never);
        const sending = opened.send({ method: "version" }, { signal: controller.signal });

        setTimeout(() => controller.abort(reason), 5);

        expect(await caught(sending)).toBe(reason);
        expect(performance.now() - started).toBeLessThan(1000);
    });

    test("a response arriving after an abort is released rather than left unread", async () => {
        const controller = new AbortController();
        let cancelled = 0;
        let respond: (response: Response) => void = () => {};
        const opened = openEngine(
            () =>
                new Promise<Response>((resolve) => {
                    respond = resolve;
                }),
        );
        const sending = opened.send({ method: "version" }, { signal: controller.signal });

        controller.abort(new Error("client went away"));
        await caught(sending);

        respond(
            new Response(
                new ReadableStream({
                    cancel() {
                        cancelled++;
                    },
                }),
            ),
        );
        await Bun.sleep(5);

        expect(cancelled).toBe(1);
    });

    test("aborting while the body is being read rejects with the reason", async () => {
        const controller = new AbortController();
        const reason = new Error("client went away");
        const opened = openEngine(async () => new Response(new ReadableStream({ pull() {} })));
        const sending = opened.send({ method: "version" }, { signal: controller.signal });

        await Bun.sleep(5);
        controller.abort(reason);

        expect(await caught(sending)).toBe(reason);
    });

    test("a body which a fetch errors on abort is reported with the reason", async () => {
        const controller = new AbortController();
        const reason = new DOMException("The operation was aborted.", "AbortError");
        const opened = openEngine(async (_, init) => {
            let fail: (error: unknown) => void = () => {};

            init?.signal?.addEventListener("abort", () => fail(init.signal?.reason), {
                once: true,
            });

            return new Response(
                new ReadableStream({
                    start(stream) {
                        fail = (error) => stream.error(error);
                    },
                }),
            );
        });
        const sending = opened.send({ method: "version" }, { signal: controller.signal });

        await Bun.sleep(5);
        controller.abort(reason);

        expect(await caught(sending)).toBe(reason);
    });

    test("an error response is read abortably too", async () => {
        const controller = new AbortController();
        const reason = new Error("client went away");
        const opened = openEngine(
            async () => new Response(new ReadableStream({ pull() {} }), { status: 500 }),
        );
        const sending = opened.send({ method: "version" }, { signal: controller.signal });

        await Bun.sleep(5);
        controller.abort(reason);

        expect(await caught(sending)).toBe(reason);
    });

    test("signals are not held on to once a request has finished", async () => {
        const controller = new AbortController();
        let held = 0;
        const add = controller.signal.addEventListener.bind(controller.signal);
        const remove = controller.signal.removeEventListener.bind(controller.signal);

        controller.signal.addEventListener = ((...args: Parameters<typeof add>) => {
            held++;
            return add(...args);
        }) as typeof add;
        controller.signal.removeEventListener = ((...args: Parameters<typeof remove>) => {
            held--;
            return remove(...args);
        }) as typeof remove;

        const opened = openEngine(async () => answer("surrealdb-3.0.0"));

        for (let i = 0; i < 10; i++) {
            await opened.send({ method: "version" }, { signal: controller.signal });
        }

        expect(held).toBe(0);
    });
});

describe("fetchOptions", () => {
    test("are merged into the init of every request", async () => {
        const received: RequestInit[] = [];
        const opened = openEngine(
            async (_, init) => {
                received.push(init ?? {});
                return answer("surrealdb-3.0.0");
            },
            { fetchOptions: { cache: "no-store", priority: "high", keepalive: true } },
        );

        await opened.send({ method: "version" });
        await opened.send({ method: "version" });

        expect(received).toHaveLength(2);

        for (const init of received) {
            expect(init.cache).toBe("no-store");
            expect((init as { priority?: string }).priority).toBe("high");
            expect(init.keepalive).toBe(true);
            expect(init.method).toBe("POST");
        }
    });

    test("cannot replace what the SDK controls", async () => {
        const controller = new AbortController();
        let received: RequestInit | undefined;
        const opened = openEngine(
            async (_, init) => {
                received = init;
                return answer("surrealdb-3.0.0");
            },
            {
                fetchOptions: {
                    method: "GET",
                    body: "hijacked",
                    headers: { "Content-Type": "text/plain" },
                    signal: new AbortController().signal,
                },
            },
        );

        await opened.send({ method: "version" }, { signal: controller.signal });

        expect(received?.method).toBe("POST");
        expect(received?.body).not.toBe("hijacked");
        expect((received?.headers as Record<string, string>)["Content-Type"]).toBe(
            "application/cbor",
        );
        expect(received?.signal).toBe(controller.signal);
    });

    test("do nothing when absent", async () => {
        let received: RequestInit | undefined;
        const opened = openEngine(async (_, init) => {
            received = init;
            return answer("surrealdb-3.0.0");
        });

        await opened.send({ method: "version" });

        expect(received && "cache" in received).toBe(false);
    });
});
