import { describe, expect, mock, test } from "bun:test";
import { Spectron } from "@surrealdb/spectron";

describe("knowledge uploads", () => {
    test("upload sends multipart with Uint8Array file", async () => {
        let body: FormData | undefined;
        const fetchImpl = mock((_u: string | URL, init?: RequestInit) => {
            body = init?.body as FormData;
            return Promise.resolve(
                new Response(
                    JSON.stringify({
                        id: "d1",
                        status: "queued",
                        contentHash: "x",
                        deduplicated: false,
                    }),
                    {
                        status: 200,
                        headers: { "Content-Type": "application/json" },
                    },
                ),
            );
        });
        const s = new Spectron({
            context: "c",
            apiKey: "k",
            endpoint: "https://api.test",
            fetchImpl: fetchImpl as unknown as typeof fetch,
        });
        const res = await s.knowledge.upload({
            file: new Uint8Array([1, 2, 3]),
            filename: "a.txt",
            mimeType: "text/plain",
        });
        expect(res.id).toBe("d1");
        expect(body).toBeInstanceOf(FormData);
        const file = body?.get("file");
        expect(file).toBeInstanceOf(Blob);
        expect((file as Blob).size).toBe(3);
    });

    test("nodes.upsert JSON shape matches Python client", async () => {
        let init: RequestInit | undefined;
        const fetchImpl = mock((_u: string | URL, i?: RequestInit) => {
            init = i;
            return Promise.resolve(new Response(null, { status: 204 }));
        });
        const s = new Spectron({
            context: "c",
            apiKey: "k",
            endpoint: "https://api.test",
            fetchImpl: fetchImpl as unknown as typeof fetch,
        });
        await s.knowledge.nodes.upsert({
            nodes: [{ kind: "Person", slug: "x", title: "X" }],
            relations: [{ label: "knows", to: { kind: "Person", slug: "y" } }],
        });
        expect(init?.method).toBe("POST");
        const payload = JSON.parse(String(init?.body));
        expect(payload.nodes).toHaveLength(1);
        expect(payload.relations).toHaveLength(1);
    });
});
