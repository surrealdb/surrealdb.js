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

describe("facts.attributes", () => {
    test("GETs /attributes with its filters and pagination", async () => {
        let url = "";
        const fetchImpl = mock((u: string | URL) => {
            url = String(u);
            return Promise.resolve(jsonResponse({ attributes: [], page: { hasMore: false } }));
        });
        await client(fetchImpl).facts.attributes({
            entity: "person/tobie",
            key: "employer",
            limit: 50,
            count: true,
        });
        expect(url).toContain("/api/v1/ctx-1/attributes");
        expect(url).toContain("entity=person%2Ftobie");
        expect(url).toContain("key=employer");
        expect(url).toContain("limit=50");
        expect(url).toContain("count=true");
    });

    test("allAttributes follows the cursor to exhaustion", async () => {
        const urls: string[] = [];
        const fetchImpl = mock((u: string | URL) => {
            urls.push(String(u));
            return Promise.resolve(
                jsonResponse(
                    urls.length === 1
                        ? {
                              attributes: [{ id: "attribute:1" }],
                              page: { hasMore: true, nextCursor: "c2" },
                          }
                        : { attributes: [{ id: "attribute:2" }], page: { hasMore: false } },
                ),
            );
        });
        const rows = await client(fetchImpl).facts.allAttributes({ entity: "person/tobie" });
        expect(rows).toHaveLength(2);
        expect(urls[1]).toContain("cursor=c2");
    });
});

describe("facts.relations", () => {
    test("GETs /relations with src, dst and label", async () => {
        let url = "";
        const fetchImpl = mock((u: string | URL) => {
            url = String(u);
            return Promise.resolve(jsonResponse({ relations: [], page: { hasMore: false } }));
        });
        await client(fetchImpl).facts.relations({
            src: "person/tobie",
            dst: "company/acme",
            label: "works_at",
        });
        expect(url).toContain("/api/v1/ctx-1/relations");
        expect(url).toContain("src=person%2Ftobie");
        expect(url).toContain("dst=company%2Facme");
        expect(url).toContain("label=works_at");
    });

    test("allEdgesOf walks both directions and concatenates outbound first", async () => {
        const urls: string[] = [];
        const fetchImpl = mock((u: string | URL) => {
            const url = String(u);
            urls.push(url);
            const outbound = url.includes("src=");
            return Promise.resolve(
                jsonResponse({
                    relations: [{ id: outbound ? "relation:out" : "relation:in" }],
                    page: { hasMore: false },
                }),
            );
        });
        const edges = await client(fetchImpl).facts.allEdgesOf("person/tobie");
        expect(edges.map((e) => e.id)).toEqual(["relation:out", "relation:in"]);
        expect(urls.some((u) => u.includes("src=person%2Ftobie"))).toBe(true);
        expect(urls.some((u) => u.includes("dst=person%2Ftobie"))).toBe(true);
    });
});

describe("facts.actions", () => {
    test("GETs /actions with the event-time bounds", async () => {
        let url = "";
        const fetchImpl = mock((u: string | URL) => {
            url = String(u);
            return Promise.resolve(jsonResponse({ actions: [], page: { hasMore: false } }));
        });
        await client(fetchImpl).facts.actions({
            actor: "person/tobie",
            verb: "shipped",
            since: "2026-01-01T00:00:00Z",
            until: "2026-06-01T00:00:00Z",
        });
        expect(url).toContain("/api/v1/ctx-1/actions");
        expect(url).toContain("actor=person%2Ftobie");
        expect(url).toContain("verb=shipped");
        expect(url).toContain("since=2026-01-01T00%3A00%3A00Z");
        expect(url).toContain("until=2026-06-01T00%3A00%3A00Z");
    });
});
