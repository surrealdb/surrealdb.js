import { afterEach, describe, expect, test } from "bun:test";
import { rejection } from "../__helpers__/mock-client";
import { deferred } from "../__helpers__/mock-fetch";
import {
    chunked,
    closeTransfers,
    connect,
    installXhr,
    received,
    recorder,
} from "../__helpers__/transfer";

afterEach(closeTransfers);

const browser = { browser: true };

describe("import progress", () => {
    test("an import without progress uploads its body as before", async () => {
        const { db, calls } = await connect();

        await db.import("CREATE a;");

        expect(calls[0]?.init.body).toBeInstanceOf(Blob);
    });

    test("a string is counted as it is uploaded, against its size, by the last callback configured", async () => {
        const sql = "OPTION IMPORT;\nCREATE a;\n".repeat(10_000);
        const size = new TextEncoder().encode(sql).byteLength;
        const replaced = recorder();
        const { events, callback } = recorder();
        const { db } = await connect(async (init) => {
            expect(await received(init.body)).toBe(sql);
            return new Response("[]");
        });

        await db.import(sql).progress(replaced.callback).progress(callback);

        expect(replaced.events).toEqual([]);
        expect(events.length).toBeGreaterThan(0);

        for (let i = 1; i < events.length; i++) {
            expect(events[i]?.loaded).toBeGreaterThan(events[i - 1]?.loaded ?? 0);
        }

        expect(events.at(-1)).toEqual({ loaded: size, total: size });
    });

    test("a stream is counted as it is uploaded, with no total, and read only as fast", async () => {
        const encoder = new TextEncoder();
        let pulled = 0;
        const source = new ReadableStream<Uint8Array>(
            {
                pull(controller) {
                    if (++pulled > 100) return controller.close();
                    controller.enqueue(encoder.encode("CREATE a;"));
                },
            },
            { highWaterMark: 0 },
        );
        const { events, callback } = recorder();
        const { db } = await connect(async (init) => {
            const reader = (init.body as ReadableStream<Uint8Array>).getReader();

            await reader.read();
            await new Promise((resolve) => setTimeout(resolve, 10));

            // Nothing was read ahead into memory while the upload waited
            expect(pulled).toBeLessThanOrEqual(3);
            expect(events.length).toBeLessThanOrEqual(3);

            while (!(await reader.read()).done) {}
            return new Response("[]");
        });

        await db.import(source).progress(callback);

        expect(events.at(-1)).toEqual({ loaded: 900, total: undefined });
    });

    test("a callback which throws does not fail the import, and is rethrown on its own", async () => {
        const failure = new Error("callback failed");
        const queued: VoidFunction[] = [];
        const realQueue = globalThis.queueMicrotask;
        const { db } = await connect(async (init) => {
            await received(init.body);
            return new Response("[]");
        });

        globalThis.queueMicrotask = (task) => queued.push(task);

        try {
            await db.import("CREATE a;").progress(() => {
                throw failure;
            });
        } finally {
            globalThis.queueMicrotask = realQueue;
        }

        expect(queued).toHaveLength(1);
        expect(() => queued[0]?.()).toThrow(failure);
    });
});

describe("import progress in a browser", () => {
    test("a Blob is uploaded with XMLHttpRequest, which reports its progress", async () => {
        const requests = installXhr();
        const { db, calls } = await connect(undefined, browser);
        const { events, callback } = recorder();
        const file = new Blob(["CREATE a;CREATE b;"]);

        await db.import(file).progress(callback);

        expect(calls.filter((call) => call.path.endsWith("/import"))).toEqual([]);
        expect(requests).toHaveLength(1);

        const [xhr] = requests;
        expect(xhr?.method).toBe("POST");
        expect(xhr?.url).toBe("http://localhost:8000/import");
        expect(xhr?.body).toBe(file);
        expect(xhr?.headers).toMatchObject({
            Accept: "application/json",
            "Surreal-NS": "test",
            "Surreal-DB": "test",
        });
        expect(events).toEqual([
            { loaded: 9, total: 18 },
            { loaded: 18, total: 18 },
        ]);
    });

    test("an import without progress is fetched as before", async () => {
        const requests = installXhr();
        const { db, calls } = await connect(undefined, browser);

        await db.import("CREATE a;");

        expect(requests).toEqual([]);
        expect(calls.filter((call) => call.path.endsWith("/import"))).toHaveLength(1);
    });

    test("aborting stops the upload and rejects with the reason", async () => {
        const requests = installXhr({ stall: true });
        const { db } = await connect(undefined, browser);
        const controller = new AbortController();
        const reason = new Error("client went away");

        const pending = rejection(
            db
                .import("CREATE a;")
                .progress(() => {})
                .signal(controller.signal),
        );

        await new Promise((resolve) => setTimeout(resolve, 5));
        controller.abort(reason);

        expect(await pending).toBe(reason);
        expect(requests[0]?.aborted).toBe(true);
    });
});

describe("export progress", () => {
    const sql = "DEFINE TABLE person;\n".repeat(1_000);
    const size = new TextEncoder().encode(sql).byteLength;

    test("an export is counted as it is received, against its length", async () => {
        const { events, callback } = recorder();
        const { db } = await connect(
            () =>
                new Response(chunked([sql.slice(0, 100), sql.slice(100)]), {
                    headers: { "Content-Length": String(size) },
                }),
        );

        expect(await db.export().progress(callback)).toBe(sql);
        expect(events).toEqual([
            { loaded: 100, total: size },
            { loaded: size, total: size },
        ]);
    });

    test("a raw export is streamed to the caller, and counted as its body is read", async () => {
        const encoder = new TextEncoder();
        const finished = deferred<void>();
        const { events, callback } = recorder();
        const { db } = await connect(
            () =>
                new Response(
                    new ReadableStream<Uint8Array>({
                        async start(controller) {
                            controller.enqueue(encoder.encode("DEFINE TABLE a;"));
                            await finished.promise;
                            controller.enqueue(encoder.encode("DEFINE TABLE b;"));
                            controller.close();
                        },
                    }),
                ),
        );

        const response = await db.export().raw().progress(callback);
        const reader = response.body?.getReader() as ReadableStreamDefaultReader<Uint8Array>;

        expect(events).toEqual([]);

        // The first chunk is read, and counted, while the server is still sending
        const first = await reader.read();
        expect(new TextDecoder().decode(first.value)).toBe("DEFINE TABLE a;");
        expect(events).toEqual([{ loaded: 15, total: undefined }]);

        finished.resolve();

        expect(new TextDecoder().decode((await reader.read()).value)).toBe("DEFINE TABLE b;");
        expect((await reader.read()).done).toBe(true);
        expect(events.at(-1)).toEqual({ loaded: 30, total: undefined });
    });

    test("a model export is counted as it is received", async () => {
        const { events, callback } = recorder();
        const { db } = await connect(() => new Response(new Uint8Array([1, 2, 3, 4])));

        const bytes = await db.exportModel("m", "1.0.0").progress(callback);

        expect(bytes).toEqual(new Uint8Array([1, 2, 3, 4]));
        expect(events.at(-1)?.loaded).toBe(4);
    });
});
