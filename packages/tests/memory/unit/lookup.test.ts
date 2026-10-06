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

const emptySection = { items: [], truncated: false };

function lookupBody(resolution: unknown) {
    return {
        resolution,
        facts: emptySection,
        relations: emptySection,
        events: emptySection,
        passages: emptySection,
        entities: emptySection,
        uncertainty: emptySection,
    };
}

describe("client.lookup", () => {
    test("POSTs to /lookup with an idempotency key", async () => {
        let url = "";
        let init: RequestInit | undefined;
        const fetchImpl = mock((u: string | URL, i?: RequestInit) => {
            url = String(u);
            init = i;
            return Promise.resolve(
                jsonResponse(
                    lookupBody({
                        kind: "entity",
                        confidence: 1,
                        subject: {
                            entity: { id: "entity:1", type: "person", name: "tobie" },
                            score: 1,
                            factCount: 7,
                        },
                    }),
                ),
            );
        });
        const res = await client(fetchImpl).lookup("who is tobie");
        expect(init?.method).toBe("POST");
        expect(url.endsWith("/api/v1/ctx-1/lookup")).toBe(true);
        expect(JSON.parse(String(init?.body))).toEqual({ query: "who is tobie" });
        // A read behind a POST, so it takes the retry budget every other read gets.
        const headers = init?.headers as Record<string, string>;
        expect(typeof headers["Idempotency-Key"]).toBe("string");
        expect(res.resolution.kind).toBe("entity");
    });

    test("sends every option the endpoint accepts, and nothing else", async () => {
        let init: RequestInit | undefined;
        const fetchImpl = mock((_u: string | URL, i?: RequestInit) => {
            init = i;
            return Promise.resolve(jsonResponse(lookupBody({ kind: "topic" })));
        });
        await client(fetchImpl).lookup("acme", {
            subject: "company/acme",
            entityType: "company",
            ambiguityMargin: 0.3,
            include: ["facts", "passages"],
            factLimit: 20,
            relationLimit: 10,
            eventLimit: 5,
            passageLimit: 3,
            uncertaintyLimit: 2,
        });
        expect(JSON.parse(String(init?.body))).toEqual({
            query: "acme",
            subject: "company/acme",
            entityType: "company",
            ambiguityMargin: 0.3,
            include: ["facts", "passages"],
            factLimit: 20,
            relationLimit: 10,
            eventLimit: 5,
            passageLimit: 3,
            uncertaintyLimit: 2,
        });
    });

    test("resolution narrows on kind", async () => {
        const fetchImpl = mock(() =>
            Promise.resolve(
                jsonResponse(
                    lookupBody({
                        kind: "ambiguous",
                        candidates: [
                            {
                                entity: { id: "entity:1", type: "product", name: "atlas" },
                                score: 0.8,
                                factCount: 2,
                                distinguisher: "shipped in March",
                            },
                        ],
                    }),
                ),
            ),
        );
        const res = await client(fetchImpl).lookup("atlas");
        if (res.resolution.kind !== "ambiguous") throw new Error("expected an ambiguous answer");
        expect(res.resolution.candidates[0]?.distinguisher).toBe("shipped in March");
    });
});

describe("client.context", () => {
    test("carries the subject for the copy-as-context export", async () => {
        let init: RequestInit | undefined;
        const fetchImpl = mock((_u: string | URL, i?: RequestInit) => {
            init = i;
            return Promise.resolve(jsonResponse({ context: "blob", queryMs: 1, tier: "direct" }));
        });
        await client(fetchImpl).context("recent work", { subject: "person/tobie" });
        expect(JSON.parse(String(init?.body))).toEqual({
            query: "recent work",
            subject: "person/tobie",
        });
    });
});

describe("client.uncertainty", () => {
    const flag = {
        id: "uncertainty:1",
        about: "tobie's employer",
        reason: "contradiction",
        resolved: false,
        resolvable: true,
        scope: [],
        labels: [],
        createdAt: "2026-01-01T00:00:00Z",
        entity: "entity:person/tobie",
        key: "employer",
    };

    test("list GETs /uncertainty with its filters", async () => {
        let url = "";
        const fetchImpl = mock((u: string | URL) => {
            url = String(u);
            return Promise.resolve(jsonResponse({ unknowns: [flag], page: { hasMore: false } }));
        });
        const page = await client(fetchImpl).uncertainty.list({
            entity: "person/tobie",
            resolved: false,
            limit: 20,
        });
        expect(url).toContain("/api/v1/ctx-1/uncertainty");
        expect(url).toContain("entity=person%2Ftobie");
        expect(url).toContain("resolved=false");
        expect(url).toContain("limit=20");
        expect(page.unknowns[0]?.resolvable).toBe(true);
    });

    test("count asks for one row and reads the total", async () => {
        let url = "";
        const fetchImpl = mock((u: string | URL) => {
            url = String(u);
            return Promise.resolve(
                jsonResponse({ unknowns: [flag], page: { hasMore: true, totalSize: 12 } }),
            );
        });
        const total = await client(fetchImpl).uncertainty.count({ resolved: false });
        expect(url).toContain("limit=1");
        expect(url).toContain("count=true");
        expect(total).toBe(12);
    });

    test("listAll follows the cursor to exhaustion", async () => {
        const urls: string[] = [];
        const fetchImpl = mock((u: string | URL) => {
            urls.push(String(u));
            return Promise.resolve(
                jsonResponse(
                    urls.length === 1
                        ? { unknowns: [flag], page: { hasMore: true, nextCursor: "c2" } }
                        : {
                              unknowns: [{ ...flag, id: "uncertainty:2" }],
                              page: { hasMore: false },
                          },
                ),
            );
        });
        const rows = await client(fetchImpl).uncertainty.listAll({ resolved: false });
        expect(rows.map((r) => r.id)).toEqual(["uncertainty:1", "uncertainty:2"]);
        expect(urls[1]).toContain("cursor=c2");
    });

    test("resolve POSTs the accepted value and unwraps the settled flag", async () => {
        let url = "";
        let init: RequestInit | undefined;
        const fetchImpl = mock((u: string | URL, i?: RequestInit) => {
            url = String(u);
            init = i;
            return Promise.resolve(
                jsonResponse({
                    uncertainty: { ...flag, resolved: true, resolvable: false },
                }),
            );
        });
        const settled = await client(fetchImpl).uncertainty.resolve("uncertainty:1", "SurrealDB", {
            note: "confirmed in the offer letter",
        });
        expect(init?.method).toBe("POST");
        expect(url.endsWith("/api/v1/ctx-1/uncertainty/uncertainty%3A1/resolve")).toBe(true);
        expect(JSON.parse(String(init?.body))).toEqual({
            acceptedValue: "SurrealDB",
            note: "confirmed in the offer letter",
        });
        expect(settled.resolved).toBe(true);
    });

    test("resolve omits an absent note rather than sending null", async () => {
        let init: RequestInit | undefined;
        const fetchImpl = mock((_u: string | URL, i?: RequestInit) => {
            init = i;
            return Promise.resolve(jsonResponse({ uncertainty: { ...flag, resolved: true } }));
        });
        await client(fetchImpl).uncertainty.resolve("uncertainty:1", "SurrealDB");
        expect(JSON.parse(String(init?.body))).toEqual({ acceptedValue: "SurrealDB" });
    });
});
