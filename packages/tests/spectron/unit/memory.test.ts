import { describe, expect, mock, test } from "bun:test";
import { Spectron } from "@surrealdb/spectron";

function jsonResponse(data: unknown, status = 200): Response {
    return new Response(JSON.stringify(data), {
        status,
        headers: { "Content-Type": "application/json" },
    });
}

describe("Spectron memory paths", () => {
    test("query posts to /api/v1/{ctx}/query", async () => {
        let url = "";
        const fetchImpl = mock((u: string | URL, init?: RequestInit) => {
            url = String(u);
            expect(init?.method).toBe("POST");
            expect(JSON.parse(String(init?.body))).toEqual({ query: "hi", k: 3 });
            return Promise.resolve(jsonResponse({ hits: [] }));
        });
        const s = new Spectron({
            context: "ctx-1",
            apiKey: "k",
            baseUrl: "https://api.test",
            fetchImpl: fetchImpl as unknown as typeof fetch,
        });
        const res = await s.query({ query: "hi", k: 3 });
        expect(res.hits).toEqual([]);
        expect(url).toContain("/api/v1/ctx-1/query");
    });

    test("context posts to /api/v1/{ctx}/context", async () => {
        let path = "";
        const fetchImpl = mock((u: string | URL, _init?: RequestInit) => {
            path = String(u);
            return Promise.resolve(jsonResponse({ context: "blob" }));
        });
        const s = new Spectron({
            context: "c",
            apiKey: "k",
            baseUrl: "https://api.test",
            fetchImpl: fetchImpl as unknown as typeof fetch,
        });
        const res = await s.context({ query: "q" });
        expect(res.context).toBe("blob");
        expect(path.endsWith("/api/v1/c/context")).toBe(true);
    });

    test("sessions.create POST /sessions", async () => {
        let path = "";
        const fetchImpl = mock((u: string | URL) => {
            path = String(u);
            return Promise.resolve(jsonResponse({ id: "s1" }));
        });
        const s = new Spectron({
            context: "c",
            apiKey: "k",
            baseUrl: "https://api.test",
            fetchImpl: fetchImpl as unknown as typeof fetch,
        });
        const session = await s.sessions.create({ scope: { u: "1" } });
        expect(session.id).toBe("s1");
        expect(path.endsWith("/api/v1/c/sessions")).toBe(true);
    });

    test("health GET /api/v1/health", async () => {
        let path = "";
        const fetchImpl = mock((u: string | URL, init?: RequestInit) => {
            path = String(u);
            expect(init?.method).toBe("GET");
            return Promise.resolve(new Response("", { status: 200 }));
        });
        const s = new Spectron({
            context: "c",
            apiKey: "k",
            baseUrl: "https://api.test",
            fetchImpl: fetchImpl as unknown as typeof fetch,
        });
        await s.health();
        expect(path.endsWith("/api/v1/health")).toBe(true);
    });
});
