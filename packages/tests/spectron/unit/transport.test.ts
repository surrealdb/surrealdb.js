import { describe, expect, mock, test } from "bun:test";
import { ConnectionError, ServerError, Transport } from "@surrealdb/spectron";

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
        expect(h["User-Agent"]?.startsWith("surrealdb-spectron-js/")).toBe(true);
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
});
