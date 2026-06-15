import { describe, expect, mock, test } from "bun:test";
import { Spectron } from "@surrealdb/spectron";

function jsonResponse(data: unknown, status = 200): Response {
    return new Response(JSON.stringify(data), {
        status,
        headers: { "Content-Type": "application/json" },
    });
}

function headerOf(init: RequestInit | undefined, name: string): string | null {
    return new Headers(init?.headers).get(name);
}

function client(fetchImpl: unknown): Spectron {
    return new Spectron({
        context: "ctx-1",
        apiKey: "k",
        endpoint: "https://api.test",
        fetchImpl: fetchImpl as typeof fetch,
    });
}

describe("client.onBehalfOf", () => {
    test("adds the X-Spectron-On-Behalf-Of header on delegated requests", async () => {
        let init: RequestInit | undefined;
        const fetchImpl = mock((_u: string | URL, i?: RequestInit) => {
            init = i;
            return Promise.resolve(jsonResponse({ hits: [], queryMs: 0, tier: "direct" }));
        });
        const s = client(fetchImpl).onBehalfOf("principal:alex");
        await s.recall("hi");
        expect(headerOf(init, "X-Spectron-On-Behalf-Of")).toBe("principal:alex");
    });

    test("propagates the header through sub-namespaces", async () => {
        let init: RequestInit | undefined;
        const fetchImpl = mock((_u: string | URL, i?: RequestInit) => {
            init = i;
            return Promise.resolve(jsonResponse([]));
        });
        const s = client(fetchImpl).onBehalfOf("principal:alex");
        await s.keys.list();
        expect(headerOf(init, "X-Spectron-On-Behalf-Of")).toBe("principal:alex");
    });

    test("leaves the original client unchanged", async () => {
        let init: RequestInit | undefined;
        const fetchImpl = mock((_u: string | URL, i?: RequestInit) => {
            init = i;
            return Promise.resolve(jsonResponse({ hits: [], queryMs: 0, tier: "direct" }));
        });
        const base = client(fetchImpl);
        base.onBehalfOf("principal:alex");
        await base.recall("hi");
        expect(headerOf(init, "X-Spectron-On-Behalf-Of")).toBeNull();
    });

    test("rejects an empty principal id", () => {
        const s = client(mock(() => Promise.resolve(jsonResponse({}))));
        expect(() => s.onBehalfOf("")).toThrow();
    });
});
