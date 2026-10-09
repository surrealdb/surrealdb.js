import { afterEach, describe, expect, test } from "bun:test";
import { CborCodec } from "@surrealdb/sqon";
import { HttpConnectionError, Surreal, type TransferProgress } from "surrealdb";

const codec = new CborCodec({});

type Handler = (init: RequestInit) => Promise<Response> | Response;

interface Call {
    path: string;
    init: RequestInit;
}

let open: Surreal | undefined;
const realFetch = globalThis.fetch;

afterEach(async () => {
    await open?.close();
    open = undefined;
    globalThis.fetch = realFetch;
    delete (globalThis as { XMLHttpRequest?: unknown }).XMLHttpRequest;
});

const handshake = () =>
    new Response(new Uint8Array(codec.encode({ id: "x", result: "surrealdb-3.0.0" })));

/**
 * A `fetch` which answers the handshake and hands every other request to the route.
 */
function fakeFetch(route: Handler, calls: Call[]) {
    return (async (url: URL | string, init: RequestInit = {}) => {
        const path = new URL(url.toString()).pathname;

        if (path.endsWith("/rpc")) return handshake();

        calls.push({ path, init });
        return route(init);
    }) as typeof fetch;
}

/** A Surreal instance on the HTTP engine, given a `fetchImpl` */
async function connect(route: Handler) {
    const calls: Call[] = [];
    const db = new Surreal({ fetchImpl: fakeFetch(route, calls) });

    open = db;
    await db.connect("http://localhost:8000", { versionCheck: false });
    await db.use({ namespace: "test", database: "test" });

    return { db, calls };
}

/** Read an uploaded body as the server would, in full */
async function received(body: BodyInit | null | undefined): Promise<string> {
    return new Response(body).text();
}

function recorder() {
    const events: TransferProgress[] = [];
    return { events, callback: (progress: TransferProgress) => events.push(progress) };
}

function chunked(chunks: string[]): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder();

    return new ReadableStream({
        start(controller) {
            for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
            controller.close();
        },
    });
}

function expectIncreasing(events: TransferProgress[]) {
    for (let i = 1; i < events.length; i++) {
        expect(events[i]?.loaded).toBeGreaterThan(events[i - 1]?.loaded ?? 0);
    }
}

describe("import progress", () => {
    test("an import without progress uploads its body as before", async () => {
        const { db, calls } = await connect(() => new Response("[]"));

        await db.import("CREATE a;");

        expect(calls[0]?.init.body).toBeInstanceOf(Blob);
    });

    test("a string is counted as it is uploaded, against its size", async () => {
        const sql = "OPTION IMPORT;\nCREATE a;\n".repeat(10_000);
        const size = new TextEncoder().encode(sql).byteLength;
        const { events, callback } = recorder();
        const { db } = await connect(async (init) => {
            expect(await received(init.body)).toBe(sql);
            return new Response("[]");
        });

        await db.import(sql).progress(callback);

        expect(events.length).toBeGreaterThan(0);
        expectIncreasing(events);
        expect(events.at(-1)).toEqual({ loaded: size, total: size });
    });

    test("a stream is counted as it is uploaded, with no total", async () => {
        const { events, callback } = recorder();
        const { db } = await connect(async (init) => {
            expect(await received(init.body)).toBe("CREATE a;CREATE b;");
            return new Response("[]");
        });

        await db.import(chunked(["CREATE a;", "CREATE b;"])).progress(callback);

        expect(events).toEqual([
            { loaded: 9, total: undefined },
            { loaded: 18, total: undefined },
        ]);
    });

    test("a stream is read only as fast as it is uploaded", async () => {
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
        const deferred: VoidFunction[] = [];
        const realQueue = globalThis.queueMicrotask;
        const { db } = await connect(async (init) => {
            await received(init.body);
            return new Response("[]");
        });

        globalThis.queueMicrotask = (task) => deferred.push(task);

        try {
            await db.import("CREATE a;").progress(() => {
                throw failure;
            });
        } finally {
            globalThis.queueMicrotask = realQueue;
        }

        expect(deferred).toHaveLength(1);
        expect(() => deferred[0]?.()).toThrow(failure);
    });

    test("the last callback configured is the one told", async () => {
        const first = recorder();
        const second = recorder();
        const { db } = await connect(async (init) => {
            await received(init.body);
            return new Response("[]");
        });

        await db.import("CREATE a;").progress(first.callback).progress(second.callback);

        expect(first.events).toEqual([]);
        expect(second.events.at(-1)).toEqual({ loaded: 9, total: 9 });
    });
});

interface FakeXhrScript {
    status?: number;
    body?: string;
    headers?: string;
    /** Stall after the upload, until aborted */
    stall?: boolean;
}

/** A browser's `XMLHttpRequest`, as far as the upload of an import uses it */
function installXhr(script: FakeXhrScript = {}) {
    const requests: FakeXhr[] = [];

    class FakeXhr {
        method = "";
        url = "";
        headers: Record<string, string> = {};
        body: Blob | undefined;
        aborted = false;
        withCredentials = false;
        responseType = "";
        status = 0;
        statusText = "";
        response: ArrayBuffer | null = null;
        readyState = 0;
        downloaded = false;
        upload: { onprogress?: (event: ProgressEvent) => void } = {};
        onreadystatechange?: () => void;
        onload?: () => void;
        onerror?: () => void;
        onabort?: () => void;

        constructor() {
            requests.push(this);
        }

        open(method: string, url: string) {
            this.method = method;
            this.url = url;
        }

        setRequestHeader(name: string, value: string) {
            this.headers[name] = value;
        }

        getAllResponseHeaders() {
            return script.headers ?? "content-type: application/json\r\n";
        }

        abort() {
            this.aborted = true;
            this.onabort?.();
        }

        send(body: Blob) {
            this.body = body;

            queueMicrotask(() => {
                const half = Math.floor(body.size / 2);

                for (const loaded of [half, body.size]) {
                    this.upload.onprogress?.({
                        loaded,
                        total: body.size,
                        lengthComputable: true,
                    } as ProgressEvent);
                }

                if (script.stall) return;

                this.status = script.status ?? 200;
                this.statusText = this.status === 200 ? "OK" : "Unprocessable Entity";
                this.readyState = 2;
                this.onreadystatechange?.();

                if (this.aborted) return;

                this.downloaded = true;
                this.response = new TextEncoder().encode(script.body ?? "[]").buffer as ArrayBuffer;
                this.readyState = 4;
                this.onreadystatechange?.();
                this.onload?.();
            });
        }
    }

    (globalThis as { XMLHttpRequest?: unknown }).XMLHttpRequest = FakeXhr;

    return requests;
}

/** A Surreal instance on the HTTP engine in a browser, with no `fetchImpl` */
async function connectInBrowser() {
    const calls: Call[] = [];

    globalThis.fetch = fakeFetch(() => new Response("[]"), calls);

    const db = new Surreal();
    open = db;
    await db.connect("http://localhost:8000", { versionCheck: false });
    await db.use({ namespace: "test", database: "test" });

    return { db, calls };
}

describe("import progress in a browser", () => {
    test("a Blob is uploaded with XMLHttpRequest, which reports its progress", async () => {
        const requests = installXhr();
        const { db, calls } = await connectInBrowser();
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

    test("the answer to a complete import is not downloaded", async () => {
        const requests = installXhr({ body: JSON.stringify(new Array(10_000).fill("ok")) });
        const { db } = await connectInBrowser();

        await db.import("CREATE a;").progress(() => {});

        expect(requests[0]?.aborted).toBe(true);
        expect(requests[0]?.downloaded).toBe(false);
    });

    test("an import without progress is fetched as before", async () => {
        const requests = installXhr();
        const { db, calls } = await connectInBrowser();

        await db.import("CREATE a;");

        expect(requests).toEqual([]);
        expect(calls.filter((call) => call.path.endsWith("/import"))).toHaveLength(1);
    });

    test("an import the server does not fully apply fails as it does with fetch", async () => {
        installXhr({ status: 422, body: '[{"status":"ERR","result":"bad"}]' });
        const { db } = await connectInBrowser();

        const error = await db
            .import("CREATE a;")
            .progress(() => {})
            .then(
                () => undefined,
                (error) => error,
            );

        expect(error).toBeInstanceOf(HttpConnectionError);
        expect((error as HttpConnectionError).status).toBe(422);
        expect((error as HttpConnectionError).message).toContain("bad");
    });

    test("aborting stops the upload and rejects with the reason", async () => {
        const requests = installXhr({ stall: true });
        const { db } = await connectInBrowser();
        const controller = new AbortController();
        const reason = new Error("client went away");

        const pending = db
            .import("CREATE a;")
            .progress(() => {})
            .signal(controller.signal)
            .then(
                () => undefined,
                (error) => error,
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

    test("an export is counted as it is received", async () => {
        const { events, callback } = recorder();
        const { db } = await connect(
            () => new Response(chunked([sql.slice(0, 100), sql.slice(100)])),
        );

        expect(await db.export().progress(callback)).toBe(sql);
        expect(events).toEqual([
            { loaded: 100, total: undefined },
            { loaded: size, total: undefined },
        ]);
    });

    test("a raw export is counted as its body is read", async () => {
        const { events, callback } = recorder();
        const { db } = await connect(() => new Response(chunked([sql])));

        const response = await db.export().raw().progress(callback);

        expect(events).toEqual([]);
        expect(await response.text()).toBe(sql);
        expect(events).toEqual([{ loaded: size, total: undefined }]);
    });

    test("a raw export is streamed to the caller as it arrives", async () => {
        const encoder = new TextEncoder();
        let finish: () => void = () => {};
        const finished = new Promise<void>((resolve) => {
            finish = resolve;
        });
        const { events, callback } = recorder();
        const { db } = await connect(
            () =>
                new Response(
                    new ReadableStream<Uint8Array>({
                        async start(controller) {
                            controller.enqueue(encoder.encode("DEFINE TABLE a;"));
                            await finished;
                            controller.enqueue(encoder.encode("DEFINE TABLE b;"));
                            controller.close();
                        },
                    }),
                ),
        );

        const response = await db.export().raw().progress(callback);
        const reader = response.body?.getReader() as ReadableStreamDefaultReader<Uint8Array>;

        // The first chunk is read, and counted, while the server is still sending
        const first = await reader.read();
        expect(new TextDecoder().decode(first.value)).toBe("DEFINE TABLE a;");
        expect(events).toEqual([{ loaded: 15, total: undefined }]);

        finish();

        expect(new TextDecoder().decode((await reader.read()).value)).toBe("DEFINE TABLE b;");
        expect((await reader.read()).done).toBe(true);
        expect(events.at(-1)).toEqual({ loaded: 30, total: undefined });
    });

    test("an export with a length is counted against it", async () => {
        const { events, callback } = recorder();
        const { db } = await connect(
            () =>
                new Response(chunked([sql]), {
                    headers: { "Content-Length": String(size) },
                }),
        );

        await db.export().progress(callback);

        expect(events).toEqual([{ loaded: size, total: size }]);
    });

    test("a model export is counted as it is received", async () => {
        const { events, callback } = recorder();
        const { db } = await connect(() => new Response(new Uint8Array([1, 2, 3, 4])));

        const bytes = await db.exportModel("m", "1.0.0").progress(callback);

        expect(bytes).toEqual(new Uint8Array([1, 2, 3, 4]));
        expect(events.at(-1)?.loaded).toBe(4);
    });
});
