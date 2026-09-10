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

function entityMatch(name: string) {
    return {
        entity: { id: `entity:['person','${name}']`, type: "person", name },
        score: 1,
        factCount: 4,
    };
}

describe("entities.search", () => {
    test("GETs /entities/search with the query and unwraps matches", async () => {
        let url = "";
        let method = "";
        const fetchImpl = mock((u: string | URL, init?: RequestInit) => {
            url = String(u);
            method = String(init?.method);
            return Promise.resolve(jsonResponse({ matches: [entityMatch("tobie")] }));
        });
        const matches = await client(fetchImpl).entities.search("tobie", {
            type: "person",
            limit: 5,
        });
        expect(method).toBe("GET");
        expect(url).toContain("/api/v1/ctx-1/entities/search");
        expect(url).toContain("q=tobie");
        expect(url).toContain("type=person");
        expect(url).toContain("limit=5");
        expect(matches).toHaveLength(1);
        expect(matches[0]?.entity.name).toBe("tobie");
    });

    test("sends no filters the caller did not set", async () => {
        let url = "";
        const fetchImpl = mock((u: string | URL) => {
            url = String(u);
            return Promise.resolve(jsonResponse({ matches: [] }));
        });
        await client(fetchImpl).entities.search("acme");
        expect(url).toContain("q=acme");
        expect(url).not.toContain("type=");
        expect(url).not.toContain("limit=");
    });
});

describe("entities.top", () => {
    test("GETs /entities/top and unwraps entities", async () => {
        let url = "";
        const fetchImpl = mock((u: string | URL) => {
            url = String(u);
            return Promise.resolve(jsonResponse({ entities: [entityMatch("acme")] }));
        });
        const top = await client(fetchImpl).entities.top({ by: "importance", limit: 3 });
        expect(url).toContain("/api/v1/ctx-1/entities/top");
        expect(url).toContain("by=importance");
        expect(url).toContain("limit=3");
        expect(top[0]?.entity.name).toBe("acme");
    });

    test("leaves the ordering to the server when none is given", async () => {
        let url = "";
        const fetchImpl = mock((u: string | URL) => {
            url = String(u);
            return Promise.resolve(jsonResponse({ entities: [] }));
        });
        await client(fetchImpl).entities.top();
        expect(url.endsWith("/api/v1/ctx-1/entities/top")).toBe(true);
    });
});

describe("entities.get", () => {
    test("passes the bound and the temporal filters through", async () => {
        let url = "";
        const fetchImpl = mock((u: string | URL) => {
            url = String(u);
            return Promise.resolve(
                jsonResponse({
                    entity: { id: "entity:1", type: "person", name: "tobie" },
                    attributes: [],
                    relations: [],
                    truncated: { attributes: true, relations: false },
                }),
            );
        });
        const res = await client(fetchImpl).entities.get("person", "tobie", {
            limit: 100,
            asOf: "2026-01-01T00:00:00Z",
            validFrom: "2025-01-01T00:00:00Z",
        });
        expect(url).toContain("/api/v1/ctx-1/entities/person/tobie");
        expect(url).toContain("limit=100");
        expect(url).toContain("asOf=2026-01-01T00%3A00%3A00Z");
        expect(url).toContain("validFrom=2025-01-01T00%3A00%3A00Z");
        expect(url).not.toContain("atInstant");
        expect(res.truncated.attributes).toBe(true);
    });

    test("url-encodes the type and name segments", async () => {
        let url = "";
        const fetchImpl = mock((u: string | URL) => {
            url = String(u);
            return Promise.resolve(
                jsonResponse({
                    entity: { id: "entity:1", type: "person", name: "a/b" },
                    attributes: [],
                    relations: [],
                    truncated: { attributes: false, relations: false },
                }),
            );
        });
        await client(fetchImpl).entities.get("person", "a/b");
        expect(url).toContain("/api/v1/ctx-1/entities/person/a%2Fb");
    });
});

describe("entities.neighbours", () => {
    test("GETs the neighbourhood with its filter and pagination", async () => {
        let url = "";
        const fetchImpl = mock((u: string | URL) => {
            url = String(u);
            return Promise.resolve(
                jsonResponse({
                    neighbours: [
                        {
                            label: "works_at",
                            outbound: true,
                            far: entityMatch("acme"),
                            relationId: "relation:1",
                        },
                    ],
                    page: { hasMore: false },
                }),
            );
        });
        const page = await client(fetchImpl).entities.neighbours("person", "tobie", {
            minFacts: 2,
            limit: 25,
        });
        expect(url).toContain("/api/v1/ctx-1/entities/person/tobie/neighbourhood");
        expect(url).toContain("minFacts=2");
        expect(url).toContain("limit=25");
        expect(page.neighbours[0]?.far.entity.name).toBe("acme");
    });

    test("allNeighbours follows the cursor to exhaustion", async () => {
        const urls: string[] = [];
        const fetchImpl = mock((u: string | URL) => {
            urls.push(String(u));
            const body =
                urls.length === 1
                    ? {
                          neighbours: [
                              {
                                  label: "works_at",
                                  outbound: true,
                                  far: entityMatch("acme"),
                                  relationId: "relation:1",
                              },
                          ],
                          page: { hasMore: true, nextCursor: "c2" },
                      }
                    : {
                          neighbours: [
                              {
                                  label: "knows",
                                  outbound: false,
                                  far: entityMatch("alex"),
                                  relationId: "relation:2",
                              },
                          ],
                          page: { hasMore: false },
                      };
            return Promise.resolve(jsonResponse(body));
        });
        const rows = await client(fetchImpl).entities.allNeighbours("person", "tobie");
        expect(rows.map((r) => r.far.entity.name)).toEqual(["acme", "alex"]);
        expect(urls[0]).not.toContain("cursor=");
        expect(urls[1]).toContain("cursor=c2");
    });
});

describe("entities history", () => {
    test("changes GETs the all-keys chain with pagination", async () => {
        let url = "";
        const fetchImpl = mock((u: string | URL) => {
            url = String(u);
            return Promise.resolve(jsonResponse({ history: [], page: { hasMore: false } }));
        });
        await client(fetchImpl).entities.changes("person", "tobie", { limit: 50, count: true });
        expect(url).toContain("/api/v1/ctx-1/entities/person/tobie/history");
        expect(url).toContain("limit=50");
        expect(url).toContain("count=true");
    });

    test("history still reads one key and unwraps its chain", async () => {
        let url = "";
        const fetchImpl = mock((u: string | URL) => {
            url = String(u);
            return Promise.resolve(jsonResponse({ history: [{ id: "attribute:1" }] }));
        });
        const rows = await client(fetchImpl).entities.history("person", "tobie", "employer");
        expect(url).toContain("/api/v1/ctx-1/entities/person/tobie/history/employer");
        expect(rows).toHaveLength(1);
    });
});
