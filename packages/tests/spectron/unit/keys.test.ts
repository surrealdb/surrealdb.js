import { describe, expect, mock, test } from "bun:test";
import { Spectron } from "@surrealdb/spectron";

function jsonResponse(data: unknown, status = 200): Response {
    return new Response(JSON.stringify(data), {
        status,
        headers: { "Content-Type": "application/json" },
    });
}

function client(fetchImpl: unknown): Spectron {
    return new Spectron({
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

    test("list GETs /keys and defaults to an empty array", async () => {
        let url = "";
        const fetchImpl = mock((u: string | URL) => {
            url = String(u);
            return Promise.resolve(new Response("", { status: 204 }));
        });
        const s = client(fetchImpl);
        const keys = await s.keys.list();
        expect(keys).toEqual([]);
        expect(url.endsWith("/api/v1/ctx-1/keys")).toBe(true);
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
