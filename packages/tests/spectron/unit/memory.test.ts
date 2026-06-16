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

describe("Spectron memory paths", () => {
    test("recall posts camelCase body to /query", async () => {
        let url = "";
        const fetchImpl = mock((u: string | URL, init?: RequestInit) => {
            url = String(u);
            expect(init?.method).toBe("POST");
            expect(JSON.parse(String(init?.body))).toEqual({
                query: "hi",
                k: 3,
                sessionId: "s1",
            });
            return Promise.resolve(jsonResponse({ hits: [], queryMs: 0, tier: "direct" }));
        });
        const s = client(fetchImpl);
        const res = await s.recall("hi", { k: 3, sessionId: "s1" });
        expect(res.hits).toEqual([]);
        expect(url).toContain("/api/v1/ctx-1/query");
    });

    test("remember posts snake_case body to /facts with an idempotency key", async () => {
        let init: RequestInit | undefined;
        const fetchImpl = mock((_u: string | URL, i?: RequestInit) => {
            init = i;
            return Promise.resolve(jsonResponse({ mode: "full", sessionId: "s1" }));
        });
        const s = client(fetchImpl);
        await s.remember("I was promoted to CTO", {
            sessionId: "s1",
            memoryCategory: "identity",
            scopes: "user/tobie",
        });
        expect(init?.method).toBe("POST");
        expect(JSON.parse(String(init?.body))).toEqual({
            text: "I was promoted to CTO",
            session_id: "s1",
            memory_category: "identity",
            scopes: [["user/tobie"]],
        });
        const headers = init?.headers as Record<string, string>;
        expect(typeof headers["Idempotency-Key"]).toBe("string");
        expect(headers["Idempotency-Key"]?.length).toBe(64);
    });

    test("context posts to /context", async () => {
        let path = "";
        const fetchImpl = mock((u: string | URL) => {
            path = String(u);
            return Promise.resolve(jsonResponse({ context: "blob", queryMs: 1, tier: "direct" }));
        });
        const s = client(fetchImpl);
        const res = await s.context("q");
        expect(res.context).toBe("blob");
        expect(path.endsWith("/api/v1/ctx-1/context")).toBe(true);
    });

    test("sessions.create POST /sessions", async () => {
        let path = "";
        const fetchImpl = mock((u: string | URL) => {
            path = String(u);
            return Promise.resolve(jsonResponse({ id: "s1", createdAt: "2026-01-01", scopes: [] }));
        });
        const s = client(fetchImpl);
        const session = await s.sessions.create({ scopes: "u/1" });
        expect(session.id).toBe("s1");
        expect(path.endsWith("/api/v1/ctx-1/sessions")).toBe(true);
    });

    test("whoami GET /me", async () => {
        let url = "";
        let method = "";
        const fetchImpl = mock((u: string | URL, init?: RequestInit) => {
            url = String(u);
            method = String(init?.method);
            return Promise.resolve(
                jsonResponse({
                    principalId: "principal:tobie",
                    displayName: "Tobie",
                    kind: "user",
                    enforce: true,
                    grants: {},
                    effectiveGrants: {},
                }),
            );
        });
        const s = client(fetchImpl);
        const me = await s.whoami();
        expect(me.principalId).toBe("principal:tobie");
        expect(method).toBe("GET");
        expect(url.endsWith("/api/v1/ctx-1/me")).toBe(true);
    });

    test("health GET /api/v1/health", async () => {
        let path = "";
        const fetchImpl = mock((u: string | URL, init?: RequestInit) => {
            path = String(u);
            expect(init?.method).toBe("GET");
            return Promise.resolve(new Response("", { status: 200 }));
        });
        const s = client(fetchImpl);
        await s.health();
        expect(path.endsWith("/api/v1/health")).toBe(true);
    });
});
