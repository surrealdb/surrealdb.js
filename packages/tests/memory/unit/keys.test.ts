import { describe, expect, mock, test } from "bun:test";
import { AgentMemory } from "@surrealdb/memory";

function jsonResponse(data: unknown, status = 200): Response {
    return new Response(JSON.stringify(data), {
        status,
        headers: { "Content-Type": "application/json" },
    });
}

function client(fetchImpl: unknown): AgentMemory {
    return new AgentMemory({
        context: "ctx-1",
        apiKey: "k",
        endpoint: "https://api.test",
        fetchImpl: fetchImpl as typeof fetch,
    });
}

describe("client.keys", () => {
    test("create POSTs name/grants body with ttlSeconds query", async () => {
        let url = "";
        let init: RequestInit | undefined;
        const fetchImpl = mock((u: string | URL, i?: RequestInit) => {
            url = String(u);
            init = i;
            return Promise.resolve(jsonResponse({ id: "key:1", key: "sp-key:1-secret" }));
        });
        const s = client(fetchImpl);
        const minted = await s.keys.create({
            name: "ci",
            grants: { "team/eng": ["read"] },
            ttlSeconds: 3600,
        });
        expect(minted.id).toBe("key:1");
        expect(minted.key).toBe("sp-key:1-secret");
        expect(init?.method).toBe("POST");
        expect(url).toContain("/api/v1/ctx-1/keys");
        expect(url).toContain("ttlSeconds=3600");
        expect(JSON.parse(String(init?.body))).toEqual({
            name: "ci",
            grants: { "team/eng": ["read"] },
        });
    });

    test("create omits the body when no name/grants are given", async () => {
        let init: RequestInit | undefined;
        const fetchImpl = mock((_u: string | URL, i?: RequestInit) => {
            init = i;
            return Promise.resolve(jsonResponse({ id: "key:2", key: "sp-key:2-secret" }));
        });
        const s = client(fetchImpl);
        await s.keys.create();
        expect(init?.body).toBeUndefined();
    });

    test("list GETs /keys and forwards the pagination parameters", async () => {
        let url = "";
        const fetchImpl = mock((u: string | URL) => {
            url = String(u);
            return Promise.resolve(
                new Response(JSON.stringify({ keys: [], page: { hasMore: false } }), {
                    status: 200,
                    headers: { "content-type": "application/json" },
                }),
            );
        });
        const s = client(fetchImpl);
        const page = await s.keys.list({ limit: 25, count: true });
        expect(page.keys).toEqual([]);
        expect(page.page.hasMore).toBe(false);
        expect(url).toContain("/api/v1/ctx-1/keys");
        expect(url).toContain("limit=25");
        expect(url).toContain("count=true");
    });

    test("listAll follows nextCursor to exhaustion", async () => {
        const urls: string[] = [];
        const pages = [
            {
                keys: [{ id: "a", name: "a", createdAt: "t" }],
                page: { hasMore: true, nextCursor: "c1" },
            },
            { keys: [{ id: "b", name: "b", createdAt: "t" }], page: { hasMore: false } },
        ];
        const fetchImpl = mock((u: string | URL) => {
            urls.push(String(u));
            return Promise.resolve(
                new Response(JSON.stringify(pages[urls.length - 1]), {
                    status: 200,
                    headers: { "content-type": "application/json" },
                }),
            );
        });
        const s = client(fetchImpl);
        const keys = await s.keys.listAll();
        expect(keys.map((k) => k.id)).toEqual(["a", "b"]);
        expect(urls).toHaveLength(2);
        expect(urls[0]).not.toContain("cursor=");
        expect(urls[1]).toContain("cursor=c1");
    });

    test("listAll degrades to an empty array on an empty body", async () => {
        const fetchImpl = mock(() => Promise.resolve(new Response("", { status: 204 })));
        const s = client(fetchImpl);
        expect(await s.keys.listAll()).toEqual([]);
    });

    test("delete DELETEs /keys/{name} (path-encoded)", async () => {
        let url = "";
        let method = "";
        const fetchImpl = mock((u: string | URL, init?: RequestInit) => {
            url = String(u);
            method = String(init?.method);
            return Promise.resolve(new Response("", { status: 204 }));
        });
        const s = client(fetchImpl);
        await s.keys.delete("key:1");
        expect(method).toBe("DELETE");
        expect(url).toContain("/api/v1/ctx-1/keys/key%3A1");
    });

    test("rotate POSTs /keys/{name}/rotate with ttlSeconds query", async () => {
        let url = "";
        let init: RequestInit | undefined;
        const fetchImpl = mock((u: string | URL, i?: RequestInit) => {
            url = String(u);
            init = i;
            return Promise.resolve(jsonResponse({ id: "key:1", key: "sp-key:1-rotated" }));
        });
        const s = client(fetchImpl);
        const minted = await s.keys.rotate("key:1", { ttlSeconds: 60 });
        expect(minted.key).toBe("sp-key:1-rotated");
        expect(init?.method).toBe("POST");
        expect(url).toContain("/api/v1/ctx-1/keys/key%3A1/rotate");
        expect(url).toContain("ttlSeconds=60");
    });
});
