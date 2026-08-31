import { describe, expect, mock, test } from "bun:test";
import { CancelledError, ConnectionError, ServerError, Transport } from "@surrealdb/memory";

describe("Transport", () => {
    test("sends Authorization bearer and user-agent on JSON POST", async () => {
        const calls: RequestInit[] = [];
        const fetchImpl = mock((_url: string | URL, init?: RequestInit) => {
            calls.push(init ?? {});
            return Promise.resolve(
                new Response(JSON.stringify({ ok: true }), {
                    status: 200,
                    headers: { "Content-Type": "application/json" },
                }),
            );
        });
        const t = new Transport({
            apiKey: "k",
            endpoint: "https://example.test",
            fetchImpl: fetchImpl as unknown as typeof fetch,
        });
        const body = await t.requestJson("POST", "/api/v1/health", { body: { a: 1 } });
        expect(body).toEqual({ ok: true });
        const init = calls[0];
        expect(init.headers).toBeDefined();
        const h = init.headers as Record<string, string>;
        expect(h.Authorization).toBe("Bearer k");
        expect(h["User-Agent"]?.startsWith("surrealdb-memory-js/")).toBe(true);
        expect(h["Content-Type"]).toBe("application/json");
    });

    test("retries GET on 500 then succeeds", async () => {
        let n = 0;
        const fetchImpl = mock(() => {
            n += 1;
            if (n === 1) {
                return Promise.resolve(
                    new Response(JSON.stringify({ title: "a" }), { status: 500 }),
                );
            }
            return Promise.resolve(
                new Response(JSON.stringify({ hits: [] }), {
                    status: 200,
                    headers: { "Content-Type": "application/json" },
                }),
            );
        });
        const t = new Transport({
            apiKey: "k",
            endpoint: "https://example.test",
            maxRetries: 3,
            fetchImpl: fetchImpl as unknown as typeof fetch,
        });
        const body = await t.requestJson("GET", "/x");
        expect(body).toEqual({ hits: [] });
        expect(n).toBe(2);
    });

    test("does not retry POST on 500", async () => {
        let n = 0;
        const fetchImpl = mock(() => {
            n += 1;
            return Promise.resolve(new Response(JSON.stringify({ title: "err" }), { status: 500 }));
        });
        const t = new Transport({
            apiKey: "k",
            endpoint: "https://example.test",
            maxRetries: 3,
            fetchImpl: fetchImpl as unknown as typeof fetch,
        });
        await expect(t.requestJson("POST", "/x", { body: {} })).rejects.toBeInstanceOf(ServerError);
        expect(n).toBe(1);
    });

    test("times out via AbortError -> ConnectionError", async () => {
        const fetchImpl = mock(() =>
            Promise.reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
        );
        const t = new Transport({
            apiKey: "k",
            endpoint: "https://example.test",
            timeoutMs: 10,
            maxRetries: 0,
            fetchImpl: fetchImpl as unknown as typeof fetch,
        });
        await expect(t.requestJson("GET", "/y")).rejects.toBeInstanceOf(ConnectionError);
    });

    // A fetch impl that resolves after `delayMs`, or rejects with an AbortError
    // as soon as its signal fires — mimicking a slow upload against the timeout.
    const slowFetch = (delayMs: number) =>
        mock((_url: string | URL, init?: RequestInit) => {
            return new Promise<Response>((resolve, reject) => {
                const signal = init?.signal;
                const timer = setTimeout(() => {
                    resolve(
                        new Response(JSON.stringify({ ok: true }), {
                            status: 200,
                            headers: { "Content-Type": "application/json" },
                        }),
                    );
                }, delayMs);
                signal?.addEventListener("abort", () => {
                    clearTimeout(timer);
                    reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
                });
            });
        });

    test("multipart requests are not aborted by the default timeout", async () => {
        const t = new Transport({
            apiKey: "k",
            endpoint: "https://example.test",
            timeoutMs: 5,
            maxRetries: 0,
            fetchImpl: slowFetch(30) as unknown as typeof fetch,
        });
        const form = new FormData();
        form.append("file", new Blob(["data"]), "f.bin");
        const body = await t.requestJson("POST", "/documents", { body: form });
        expect(body).toEqual({ ok: true });
    });

    test("multipart requests still honor an explicit per-request timeout", async () => {
        const t = new Transport({
            apiKey: "k",
            endpoint: "https://example.test",
            maxRetries: 0,
            fetchImpl: slowFetch(30) as unknown as typeof fetch,
        });
        const form = new FormData();
        form.append("file", new Blob(["data"]), "f.bin");
        await expect(
            t.requestJson("POST", "/documents", { body: form, timeoutMs: 5 }),
        ).rejects.toBeInstanceOf(ConnectionError);
    });

    test("JSON requests are still aborted by the default timeout", async () => {
        const t = new Transport({
            apiKey: "k",
            endpoint: "https://example.test",
            timeoutMs: 5,
            maxRetries: 0,
            fetchImpl: slowFetch(30) as unknown as typeof fetch,
        });
        await expect(t.requestJson("POST", "/x", { body: { a: 1 } })).rejects.toBeInstanceOf(
            ConnectionError,
        );
    });

    test("a caller's signal cancels a multipart send", async () => {
        const t = new Transport({
            apiKey: "k",
            endpoint: "https://example.test",
            maxRetries: 0,
            fetchImpl: slowFetch(100) as unknown as typeof fetch,
        });
        const controller = new AbortController();
        const form = new FormData();
        form.append("file", new Blob(["data"]), "f.bin");

        const pending = t.requestJson("POST", "/documents", {
            body: form,
            signal: controller.signal,
        });
        controller.abort();

        await expect(pending).rejects.toBeInstanceOf(CancelledError);
    });

    test("cancellation is reported apart from a timeout", async () => {
        // Both arrive as an AbortError, so they can only be told apart by whose
        // signal fired. Only a timeout describes something that went wrong.
        const t = new Transport({
            apiKey: "k",
            endpoint: "https://example.test",
            timeoutMs: 5,
            maxRetries: 0,
            fetchImpl: slowFetch(50) as unknown as typeof fetch,
        });

        const error = await t.requestJson("POST", "/x", { body: { a: 1 } }).catch((e) => e);

        expect(error).toBeInstanceOf(ConnectionError);
        expect(error).not.toBeInstanceOf(CancelledError);
    });

    test("an already-aborted signal cancels before the request is sent", async () => {
        const fetchImpl = mock(() => Promise.resolve(new Response("{}", { status: 200 })));
        const t = new Transport({
            apiKey: "k",
            endpoint: "https://example.test",
            maxRetries: 0,
            fetchImpl: fetchImpl as unknown as typeof fetch,
        });

        await expect(
            t.requestJson("GET", "/x", { signal: AbortSignal.abort() }),
        ).rejects.toBeInstanceOf(CancelledError);
    });

    test("a cancelled request is not retried", async () => {
        // `shouldRetry` treats a null status as a transport failure worth retrying,
        // so without the cancellation branch an aborted GET would be re-sent.
        let calls = 0;
        const fetchImpl = mock((_url: string | URL, init?: RequestInit) => {
            calls += 1;
            return new Promise<Response>((_resolve, reject) => {
                init?.signal?.addEventListener("abort", () =>
                    reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
                );
            });
        });
        const t = new Transport({
            apiKey: "k",
            endpoint: "https://example.test",
            maxRetries: 3,
            fetchImpl: fetchImpl as unknown as typeof fetch,
        });
        const controller = new AbortController();

        const pending = t.requestJson("GET", "/x", { signal: controller.signal });
        controller.abort();

        await expect(pending).rejects.toBeInstanceOf(CancelledError);
        expect(calls).toBe(1);
    });

    test("a multipart send without a progress listener stays on fetch", async () => {
        // The `XMLHttpRequest` path exists only to report progress; every other
        // request keeps the transport's regular behaviour.
        const fetchImpl = mock(() =>
            Promise.resolve(
                new Response(JSON.stringify({ id: "d1" }), {
                    status: 200,
                    headers: { "Content-Type": "application/json" },
                }),
            ),
        );
        const t = new Transport({
            apiKey: "k",
            endpoint: "https://example.test",
            fetchImpl: fetchImpl as unknown as typeof fetch,
        });
        const form = new FormData();
        form.append("file", new Blob(["data"]), "f.bin");

        await t.requestJson("POST", "/documents", { body: form });

        expect(fetchImpl).toHaveBeenCalledTimes(1);
    });
});
