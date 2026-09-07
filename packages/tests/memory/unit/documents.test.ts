import { describe, expect, mock, test } from "bun:test";
import { AgentMemory, CancelledError, ConnectionError } from "@surrealdb/memory";

function client(fetchImpl: unknown): AgentMemory {
    return new AgentMemory({
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

    // A fetch impl that never settles until its signal fires.
    const stalledFetch = () =>
        mock((_u: string | URL, init?: RequestInit) => {
            return new Promise<Response>((_resolve, reject) => {
                init?.signal?.addEventListener("abort", () =>
                    reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
                );
            });
        });

    test("forwards a caller's abort signal", async () => {
        // A large upload is otherwise unstoppable: multipart sends carry no
        // deadline, so without this the request runs until the network gives up.
        const s = client(stalledFetch());
        const controller = new AbortController();

        const pending = s.documents.upload({
            file: new Uint8Array([9]),
            signal: controller.signal,
        });
        controller.abort();

        await expect(pending).rejects.toBeInstanceOf(CancelledError);
    });

    test("bounds an upload when given an explicit timeout", async () => {
        const s = client(stalledFetch());

        const error = await s.documents
            .upload({ file: new Uint8Array([9]), timeoutMs: 5 })
            .catch((e) => e);

        expect(error).toBeInstanceOf(ConnectionError);
        expect(error).not.toBeInstanceOf(CancelledError);
    });
});

// Captures the URL and parsed JSON body of a single POST, answering `result`.
function capturePost(result: unknown) {
    const captured: { url: string; body: unknown } = { url: "", body: undefined };
    const fetchImpl = mock((u: string | URL, init?: RequestInit) => {
        captured.url = String(u);
        captured.body = JSON.parse(String(init?.body));
        expect(init?.method).toBe("POST");
        return Promise.resolve(
            new Response(JSON.stringify(result), {
                status: 200,
                headers: { "Content-Type": "application/json" },
            }),
        );
    });
    return { fetchImpl, captured };
}

describe("documents.query", () => {
    test("posts to /documents/query", async () => {
        const { fetchImpl, captured } = capturePost({ queryMs: 1, results: [] });
        const s = client(fetchImpl);
        const res = await s.documents.query({ query: "hi", k: 5 });
        expect(res.results).toEqual([]);
        expect(captured.url.endsWith("/api/v1/c/documents/query")).toBe(true);
        // No lens given, so none is sent: the server then reads the whole granted region.
        expect(captured.body).toEqual({ query: "hi", k: 5 });
    });

    test("normalises a read lens into the ScopeSets wire shape", async () => {
        const { fetchImpl, captured } = capturePost({ queryMs: 1, results: [] });
        const s = client(fetchImpl);
        await s.documents.query({ query: "hi", lens: "team/beta/*" });
        expect(captured.body).toEqual({ query: "hi", lens: [["team/beta/*"]] });

        await s.documents.query({
            query: "hi",
            lens: ["team/alpha/*", ["team/beta", "tier/gold"]],
        });
        expect(captured.body).toEqual({
            query: "hi",
            lens: [["team/alpha/*"], ["team/beta", "tier/gold"]],
        });
    });

    test("omits a lens that normalises to nothing", async () => {
        const { fetchImpl, captured } = capturePost({ queryMs: 1, results: [] });
        const s = client(fetchImpl);
        await s.documents.query({ query: "hi", lens: [] });
        expect(captured.body).toEqual({ query: "hi" });
    });
});

describe("documents.keywords.search", () => {
    test("posts to /documents/keywords/search with a normalised lens", async () => {
        const { fetchImpl, captured } = capturePost({ queryMs: 1, results: [] });
        const s = client(fetchImpl);
        const res = await s.documents.keywords.search({
            query: "needle",
            k: 3,
            threshold: 0.2,
            lens: ["team/alpha/*", "team/beta/*"],
        });
        expect(res.results).toEqual([]);
        expect(captured.url.endsWith("/api/v1/c/documents/keywords/search")).toBe(true);
        expect(captured.body).toEqual({
            query: "needle",
            k: 3,
            threshold: 0.2,
            lens: [["team/alpha/*"], ["team/beta/*"]],
        });
    });

    test("omits the lens when none is given", async () => {
        const { fetchImpl, captured } = capturePost({ queryMs: 1, results: [] });
        const s = client(fetchImpl);
        await s.documents.keywords.search({ query: "needle" });
        expect(captured.body).toEqual({ query: "needle" });
    });
});
