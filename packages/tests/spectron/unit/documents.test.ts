import { describe, expect, mock, test } from "bun:test";
import { Spectron } from "@surrealdb/spectron";

function client(fetchImpl: unknown): Spectron {
    return new Spectron({
        context: "c",
        apiKey: "k",
        endpoint: "https://api.test",
        fetchImpl: fetchImpl as typeof fetch,
    });
}

describe("documents.upload", () => {
    test("sends multipart with file and metadata parts", async () => {
        let url = "";
        let body: FormData | undefined;
        const fetchImpl = mock((u: string | URL, init?: RequestInit) => {
            url = String(u);
            body = init?.body as FormData;
            return Promise.resolve(
                new Response(
                    JSON.stringify({
                        id: "d1",
                        status: "queued",
                        contentHash: "x",
                        deduplicated: false,
                    }),
                    { status: 200, headers: { "Content-Type": "application/json" } },
                ),
            );
        });
        const s = client(fetchImpl);
        const res = await s.documents.upload({
            file: new Uint8Array([1, 2, 3]),
            filename: "a.txt",
            contentType: "text/plain",
            title: "Handbook",
            source: "https://example.test/a.txt",
        });
        expect(res.id).toBe("d1");
        expect(url.endsWith("/api/v1/c/documents")).toBe(true);
        expect(body).toBeInstanceOf(FormData);

        const file = body?.get("file");
        expect(file).toBeInstanceOf(Blob);
        expect((file as Blob).size).toBe(3);

        const metadata = body?.get("metadata");
        expect(JSON.parse(String(metadata))).toEqual({
            title: "Handbook",
            source: "https://example.test/a.txt",
        });
    });

    test("omits the metadata part when no metadata is supplied", async () => {
        let body: FormData | undefined;
        const fetchImpl = mock((_u: string | URL, init?: RequestInit) => {
            body = init?.body as FormData;
            return Promise.resolve(
                new Response(
                    JSON.stringify({
                        id: "d2",
                        status: "queued",
                        contentHash: "y",
                        deduplicated: false,
                    }),
                    { status: 200, headers: { "Content-Type": "application/json" } },
                ),
            );
        });
        const s = client(fetchImpl);
        await s.documents.upload({ file: new Uint8Array([9]) });
        expect(body?.get("metadata")).toBeNull();
        expect(body?.get("file")).toBeInstanceOf(Blob);
    });
});

describe("documents.query", () => {
    test("posts to /documents/query", async () => {
        let url = "";
        const fetchImpl = mock((u: string | URL, init?: RequestInit) => {
            url = String(u);
            expect(init?.method).toBe("POST");
            return Promise.resolve(
                new Response(JSON.stringify({ queryMs: 1, results: [] }), {
                    status: 200,
                    headers: { "Content-Type": "application/json" },
                }),
            );
        });
        const s = client(fetchImpl);
        const res = await s.documents.query({ query: "hi", k: 5 });
        expect(res.results).toEqual([]);
        expect(url.endsWith("/api/v1/c/documents/query")).toBe(true);
    });
});
