import { afterEach, describe, expect, test } from "bun:test";
import { CborCodec } from "@surrealdb/sqon";
import { ImportPromise, Surreal } from "surrealdb";
import { connectFake } from "../__helpers__/mock-engine";

const codec = new CborCodec({});

type Handler = (init: RequestInit) => Promise<Response> | Response;

interface Routes {
    export?: Handler;
    import?: Handler;
    model?: Handler;
}

interface Call {
    path: string;
    init: RequestInit;
}

let open: Surreal | undefined;

afterEach(async () => {
    await open?.close();
    open = undefined;
});

/**
 * A Surreal instance on the HTTP engine, whose `fetch` answers the handshake and hands the
 * import and export requests to the test.
 */
async function connect(routes: Routes, options: { requestTimeout?: number } = {}) {
    const calls: Call[] = [];

    const fetchImpl = (async (url: URL | string, init: RequestInit = {}) => {
        const path = new URL(url.toString()).pathname;

        if (path.endsWith("/rpc")) {
            return new Response(
                new Uint8Array(codec.encode({ id: "x", result: "surrealdb-3.0.0" })),
            );
        }

        calls.push({ path, init });

        const route = path.endsWith("/export")
            ? routes.export
            : path.endsWith("/import")
              ? routes.import
              : routes.model;

        if (!route) throw new Error(`Nothing is routed for ${path}`);

        return route(init);
    }) as typeof fetch;

    const db = new Surreal({ fetchImpl });
    open = db;
    await db.connect("http://localhost:8000", { versionCheck: false, ...options });

    return { db, calls };
}

const text = (body: string) => () => new Response(body);

/** A `fetch` as a runtime provides it: when its signal aborts, the body of its response errors. */
function honouring(init: RequestInit, body: ReadableStream): Response {
    const signal = init.signal as AbortSignal;

    return new Response(
        new ReadableStream({
            start(controller) {
                const reader = body.getReader();
                const pump = async () => {
                    for (;;) {
                        const { done, value } = await reader.read();
                        if (done) return controller.close();
                        controller.enqueue(value);
                    }
                };

                pump().catch((error) => controller.error(error));
                signal?.addEventListener("abort", () => controller.error(signal.reason), {
                    once: true,
                });
            },
        }),
    );
}

/** A body which sends what it is given, and then stalls, noting how it was left. */
function stalling(chunks: string[] = [], log: { cancelled?: unknown } = {}) {
    const encoder = new TextEncoder();
    let sent = 0;

    return {
        log,
        body: new ReadableStream<Uint8Array>({
            pull(controller) {
                if (sent < chunks.length) {
                    controller.enqueue(encoder.encode(chunks[sent++]));
                    return;
                }

                return new Promise(() => {});
            },
            cancel(reason) {
                log.cancelled = reason;
            },
        }),
    };
}

async function caught(promise: Promise<unknown>): Promise<unknown> {
    try {
        await promise;
    } catch (error) {
        return error;
    }

    throw new Error("Expected the promise to reject");
}

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

describe("export and signals", () => {
    test("an export which is not aborted is answered as before, and is handed the signal", async () => {
        const controller = new AbortController();
        const { db, calls } = await connect({ export: text("DEFINE TABLE person;") });

        expect(await db.export().signal(controller.signal)).toBe("DEFINE TABLE person;");
        expect(calls[0]?.init.signal).toBeDefined();
        expect(calls[0]?.init.signal?.aborted).toBe(false);
    });

    test("an export with no signal is handed none, and reads its body as before", async () => {
        const { db, calls } = await connect({ export: text("DEFINE TABLE person;") });

        expect(await db.export()).toBe("DEFINE TABLE person;");
        expect(calls[0]?.init.signal).toBeUndefined();
    });

    test("a signal which has aborted already rejects with the reason and requests nothing", async () => {
        const { db, calls } = await connect({ export: text("never") });
        const reason = new Error("client went away");
        const controller = new AbortController();
        controller.abort(reason);

        expect(await caught(Promise.resolve(db.export().signal(controller.signal)))).toBe(reason);
        expect(await caught(Promise.resolve(db.export().raw().signal(controller.signal)))).toBe(
            reason,
        );
        expect(
            await caught(Promise.resolve(db.exportModel("m", "1.0.0").signal(controller.signal))),
        ).toBe(reason);
        expect(calls).toEqual([]);
    });

    test("aborting while the server is working rejects with the reason", async () => {
        const controller = new AbortController();
        const reason = new Error("client went away");
        const { db } = await connect({
            export: (init) =>
                new Promise<Response>((_, reject) => {
                    init.signal?.addEventListener("abort", () => reject(init.signal?.reason), {
                        once: true,
                    });
                }),
        });

        const exporting = Promise.resolve(db.export().signal(controller.signal));

        await Bun.sleep(5);
        controller.abort(reason);

        expect(await caught(exporting)).toBe(reason);
    });

    test("aborting does not wait for a fetch which ignores signals", async () => {
        const controller = new AbortController();
        const reason = new Error("client went away");
        const started = performance.now();
        const { db } = await connect({ export: () => new Promise<Response>(() => {}) });

        const exporting = Promise.resolve(db.export().signal(controller.signal));

        await Bun.sleep(5);
        controller.abort(reason);

        expect(await caught(exporting)).toBe(reason);
        expect(performance.now() - started).toBeLessThan(1000);
    });

    test("aborting mid-download cancels the stream, whatever fetch did", async () => {
        const controller = new AbortController();
        const reason = new Error("client went away");
        const source = stalling(["DEFINE TABLE person;\n", "DEFINE TABLE other;\n"]);
        const { db } = await connect({ export: () => new Response(source.body) });

        const exporting = Promise.resolve(db.export().signal(controller.signal));

        await Bun.sleep(10);
        controller.abort(reason);

        expect(await caught(exporting)).toBe(reason);
        // Nothing is left downloading: the stream was released with the reason
        expect(source.log.cancelled).toBe(reason);
    });

    test("aborting mid-download is reported with the reason where fetch errors the body itself", async () => {
        const controller = new AbortController();
        const reason = new DOMException("The operation was aborted.", "AbortError");
        const source = stalling(["DEFINE TABLE person;\n"]);
        const { db } = await connect({ export: (init) => honouring(init, source.body) });

        const exporting = Promise.resolve(db.export().signal(controller.signal));

        await Bun.sleep(10);
        controller.abort(reason);

        expect(await caught(exporting)).toBe(reason);
    });

    test("a body is decoded whole, even when a character is split between chunks", async () => {
        const controller = new AbortController();
        const encoded = new TextEncoder().encode("DEFINE TABLE café; -- 日本語 🚀");
        const { db } = await connect({
            export: () =>
                new Response(
                    new ReadableStream({
                        start(stream) {
                            // Cut in the middle of every multi-byte character
                            for (let at = 0; at < encoded.length; at += 3) {
                                stream.enqueue(encoded.slice(at, at + 3));
                            }
                            stream.close();
                        },
                    }),
                ),
        });

        expect(await db.export().signal(controller.signal)).toBe("DEFINE TABLE café; -- 日本語 🚀");
    });

    test("a raw export is governed by the signal while its body is read", async () => {
        const controller = new AbortController();
        const reason = new DOMException("The operation was aborted.", "AbortError");
        const source = stalling(["first chunk"]);
        const { db } = await connect({ export: (init) => honouring(init, source.body) });

        const response = await db.export().raw().signal(controller.signal);
        const reader = (response.body as ReadableStream<Uint8Array>).getReader();

        expect(new TextDecoder().decode((await reader.read()).value)).toBe("first chunk");

        controller.abort(reason);

        expect(await caught(reader.read())).toBe(reason);
    });

    test("a response arriving after an abort is released rather than left downloading", async () => {
        const controller = new AbortController();
        let cancelled = 0;
        let respond: (response: Response) => void = () => {};
        const { db } = await connect({
            export: () =>
                new Promise<Response>((resolve) => {
                    respond = resolve;
                }),
        });
        const exporting = Promise.resolve(db.export().signal(controller.signal));

        await Bun.sleep(5);
        controller.abort(new Error("client went away"));
        await caught(exporting);

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

    test("an engine which ignores the signal has its late response released too", async () => {
        const controller = new AbortController();
        const reason = new Error("client went away");
        const { db, engine } = await connectFake();
        let cancelled = 0;
        let respond: (response: Response) => void = () => {};

        engine.exportSql = () =>
            new Promise<Response>((resolve) => {
                respond = resolve;
            });

        const exporting = Promise.resolve(db.export().signal(controller.signal));

        await Bun.sleep(5);
        controller.abort(reason);

        expect(await caught(exporting)).toBe(reason);

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
        await db.close();

        expect(cancelled).toBe(1);
    });

    test("a raw export keeps being governed by several signals on runtimes without AbortSignal.any", async () => {
        const any = AbortSignal.any;
        const timeout = AbortSignal.timeout;
        AbortSignal.any = undefined as never;
        AbortSignal.timeout = undefined as never;

        try {
            const first = new AbortController();
            const second = new AbortController();
            const reason = new Error("second");
            const source = stalling(["first chunk"]);
            const { db } = await connect({ export: (init) => honouring(init, source.body) });

            const response = await db
                .export()
                .raw()
                .signal(first.signal)
                .signal(second.signal)
                .requestTimeout(5000);
            const reader = (response.body as ReadableStream<Uint8Array>).getReader();

            await reader.read();
            second.abort(reason);

            expect(await caught(reader.read())).toBe(reason);
        } finally {
            AbortSignal.any = any;
            AbortSignal.timeout = timeout;
        }
    });

    test("the signal of an export which has finished is not held on to", async () => {
        const controller = new AbortController();
        const spy = spyOnListeners(controller.signal);
        const { db } = await connect({ export: text("done") });

        for (let i = 0; i < 5; i++) {
            await db.export().signal(controller.signal);
        }

        expect(spy.held).toBe(0);

        const failing = new AbortController();
        const failingSpy = spyOnListeners(failing.signal);
        const { db: other } = await connect({ export: () => new Response("no", { status: 500 }) });

        await caught(Promise.resolve(other.export().signal(failing.signal)));
        expect(failingSpy.held).toBe(0);
    });
});

describe("model export and signals", () => {
    test("is assembled from its chunks, and is handed the signal", async () => {
        const controller = new AbortController();
        const { db, calls } = await connect({
            model: () =>
                new Response(
                    new ReadableStream({
                        start(stream) {
                            stream.enqueue(new Uint8Array([1, 2, 3]));
                            stream.enqueue(new Uint8Array([4, 5]));
                            stream.close();
                        },
                    }),
                ),
        });

        const bytes = await db.exportModel("m", "1.0.0").signal(controller.signal);

        expect(Array.from(bytes)).toEqual([1, 2, 3, 4, 5]);
        expect(calls[0]?.init.signal).toBeDefined();
    });

    test("aborting mid-download cancels the stream and rejects with the reason", async () => {
        const controller = new AbortController();
        const reason = new Error("client went away");
        const source = stalling(["a"]);
        const { db } = await connect({ model: () => new Response(source.body) });

        const exporting = Promise.resolve(db.exportModel("m", "1.0.0").signal(controller.signal));

        await Bun.sleep(10);
        controller.abort(reason);

        expect(await caught(exporting)).toBe(reason);
        expect(source.log.cancelled).toBe(reason);
    });
});

describe("import and signals", () => {
    test("is lazy, like every other query, and answers as before", async () => {
        const { db, calls } = await connect({ import: () => new Response("[]") });

        const importing = db.import("DEFINE TABLE person;");

        expect(importing).toBeInstanceOf(ImportPromise);
        await Bun.sleep(5);
        expect(calls).toEqual([]);

        await importing;
        expect(calls).toHaveLength(1);
    });

    test("a signal which has aborted already means nothing is sent", async () => {
        const { db, calls } = await connect({ import: () => new Response("[]") });
        const reason = new Error("client went away");
        const controller = new AbortController();
        controller.abort(reason);

        expect(await caught(db.import("DEFINE TABLE person;").signal(controller.signal))).toBe(
            reason,
        );
        expect(calls).toEqual([]);
    });

    test("aborting while the server is working rejects with the reason", async () => {
        const controller = new AbortController();
        const reason = new Error("client went away");
        const { db } = await connect({ import: () => new Promise<Response>(() => {}) });

        const importing = db.import("DEFINE TABLE person;").signal(controller.signal);

        setTimeout(() => controller.abort(reason), 5);

        expect(await caught(importing)).toBe(reason);
    });

    test("a stream which is not aborted is uploaded as it is", async () => {
        const stream = new ReadableStream();
        const { db, calls } = await connect({ import: () => new Response("[]") });

        await db.import(stream);

        // Nothing is placed in front of it unless there is a signal to honour
        expect(calls[0]?.init.body).toBe(stream);
    });

    test("aborting mid-upload cancels the stream with the reason, even if fetch ignores signals", async () => {
        const controller = new AbortController();
        const reason = new Error("client went away");
        const source = stalling(["DEFINE TABLE person;\n"]);
        const received: string[] = [];
        const { db } = await connect({
            import: async (init) => {
                // A fetchImpl which ignores the signal, and reads the body for as long as it lasts
                const reader = (init.body as ReadableStream<Uint8Array>).getReader();

                for (;;) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    received.push(new TextDecoder().decode(value));
                }

                return new Response("[]");
            },
        });

        const importing = db.import(source.body).signal(controller.signal);

        setTimeout(() => controller.abort(reason), 20);

        expect(await caught(importing)).toBe(reason);
        expect(received).toEqual(["DEFINE TABLE person;\n"]);
        expect(source.log.cancelled).toBe(reason);
    });

    test("a timeout expiring mid-upload releases the stream with the TimeoutError", async () => {
        const source = stalling(["DEFINE TABLE person;\n"]);
        const { db } = await connect({
            import: async (init) => {
                const reader = (init.body as ReadableStream<Uint8Array>).getReader();
                while (!(await reader.read()).done) {}
                return new Response("[]");
            },
        });

        const error = (await caught(db.import(source.body).requestTimeout(30))) as Error;

        expect(error.name).toBe("TimeoutError");
        expect((source.log.cancelled as Error).name).toBe("TimeoutError");
    });

    test("an upload which finishes is unaffected by a signal which aborts afterwards", async () => {
        const controller = new AbortController();
        const spy = spyOnListeners(controller.signal);
        const { db } = await connect({ import: () => new Response("[]") });

        await db.import("DEFINE TABLE person;").signal(controller.signal);
        controller.abort(new Error("late"));

        expect(spy.held).toBe(0);
    });
});

describe("import and export have no default timeout", () => {
    const slow = async (): Promise<Response> => {
        await Bun.sleep(80);
        return new Response("done");
    };

    test("the connection's requestTimeout does not apply to them", async () => {
        const { db } = await connect(
            { export: slow, import: slow, model: () => slow() },
            { requestTimeout: 20 },
        );

        expect(await db.export()).toBe("done");
        await db.import("DEFINE TABLE person;");
        expect(await db.exportModel("m", "1.0.0")).toEqual(new TextEncoder().encode("done"));
    });

    test("a value given to the call does apply", async () => {
        const { db } = await connect(
            { export: slow, import: slow, model: () => slow() },
            { requestTimeout: 5000 },
        );

        for (const run of [
            () => db.export().requestTimeout(20),
            () => db.import("DEFINE TABLE person;").requestTimeout(20),
            () => db.exportModel("m", "1.0.0").requestTimeout(20),
        ]) {
            expect(((await caught(Promise.resolve(run()))) as Error).name).toBe("TimeoutError");
        }
    });

    test("0 means no limit, and an invalid value is refused", async () => {
        const { db } = await connect({ export: slow, import: slow });

        expect(await db.export().requestTimeout(0)).toBe("done");
        expect(() => db.export().requestTimeout(-1)).toThrow(/requestTimeout/);
        expect(() => db.import("x").requestTimeout(Number.NaN)).toThrow(/requestTimeout/);
        expect(() => db.exportModel("m", "1").requestTimeout(Number.POSITIVE_INFINITY)).toThrow(
            /requestTimeout/,
        );
    });

    test("it does not bound the body of a raw export after it has been returned, unless asked", async () => {
        const { db } = await connect({ export: text("body") }, { requestTimeout: 10 });

        const response = await db.export().raw();
        await Bun.sleep(40);

        expect(await response.text()).toBe("body");
    });
});

describe("request scopes", () => {
    test("pass their signal to import, export and model export", async () => {
        const reason = new Error("the request went away");
        const never = () => new Promise<Response>(() => {});
        const { db } = await connect({ export: never, import: never, model: never });

        for (const run of [
            (scoped: ReturnType<Surreal["withSignal"]>) => scoped.export(),
            (scoped: ReturnType<Surreal["withSignal"]>) => scoped.export().raw(),
            (scoped: ReturnType<Surreal["withSignal"]>) => scoped.exportModel("m", "1.0.0"),
            (scoped: ReturnType<Surreal["withSignal"]>) => scoped.import("DEFINE TABLE person;"),
        ]) {
            const controller = new AbortController();
            const running = Promise.resolve(run(db.withSignal(controller.signal)));

            await Bun.sleep(5);
            controller.abort(reason);

            expect(await caught(running)).toBe(reason);
        }
    });

    test("do not send once the signal has aborted", async () => {
        const reason = new Error("the request went away");
        const controller = new AbortController();
        controller.abort(reason);
        const { db, calls } = await connect({ export: text("x"), import: text("x") });
        const scoped = db.withSignal(controller.signal);

        expect(await caught(Promise.resolve(scoped.export()))).toBe(reason);
        expect(await caught(Promise.resolve(scoped.import("x")))).toBe(reason);
        expect(calls).toEqual([]);
    });

    test("combine with a signal given to the call", async () => {
        const scope = new AbortController();
        const call = new AbortController();
        const reason = new Error("this call gave up");
        const never = () => new Promise<Response>(() => {});
        const { db } = await connect({ export: never });

        const running = Promise.resolve(db.withSignal(scope.signal).export().signal(call.signal));

        await Bun.sleep(5);
        call.abort(reason);

        expect(await caught(running)).toBe(reason);
        expect(scope.signal.aborted).toBe(false);
    });

    test("an unscoped export is untouched by the scope of another", async () => {
        const gone = new AbortController();
        const { db } = await connect({ export: text("fine") });

        db.withSignal(gone.signal);
        gone.abort();

        expect(await db.export()).toBe("fine");
    });
});
