import { afterEach, describe, expect, test } from "bun:test";
import {
    applyDiagnostics,
    CborCodec,
    type ConnectOptions,
    createRemoteEngines,
    RecordId,
    Surreal,
    UnsuccessfulApiError,
} from "../../../sdk/src";

const codec = new CborCodec({});
const clients: Surreal[] = [];
afterEach(async () => {
    for (const db of clients.splice(0)) await db.close();
});

type Call = { url: URL; init: RequestInit };
async function connect(
    reply: (call: Call) => Response | Promise<Response>,
    authentication?: ConnectOptions["authentication"],
    diagnostics = false,
) {
    const calls: Call[] = [];
    const db = new Surreal({
        ...(diagnostics ? { engines: applyDiagnostics(createRemoteEngines(), () => {}) } : {}),
        fetchImpl: (async (input, init = {}) => {
            const url = new URL(String(input));
            if (url.pathname.endsWith("/rpc")) {
                const rpc = codec.decode<{ method: string }>(init.body as Uint8Array);
                if (rpc.method === "query")
                    return new Response(
                        new Uint8Array(
                            codec.encode({
                                error: {
                                    code: -32602,
                                    message: "Anonymous queries are disabled",
                                    kind: "NotAllowed",
                                },
                            }),
                        ),
                    );
                return new Response(
                    new Uint8Array(
                        codec.encode({
                            result: rpc.method === "version" ? "surrealdb-3.3.2" : null,
                        }),
                    ),
                );
            }
            const call = { url, init };
            calls.push(call);
            return reply(call);
        }) as typeof fetch,
    });
    clients.push(db);
    await db.connect("http://mock.test/proxy", { namespace: "ns", database: "db", authentication });
    return { db, calls };
}

const cbor = (body: unknown, status = 200) =>
    new Response(new Uint8Array(codec.encode(body)), {
        status,
        headers: { "Content-Type": "application/cbor" },
    });

describe("HTTP API invocation", () => {
    test("bypasses queries and preserves proxy paths, headers, and query parameters", async () => {
        const { db, calls } = await connect(() => cbor({ ok: true }));
        const result = await db
            .api("/v1")
            .get("/hello")

            .header("X-Test", "yes")
            .query("q", "a & b");
        expect(result.body).toEqual({ ok: true });
        expect(calls).toHaveLength(1);
        expect(calls[0].url.href).toBe("http://mock.test/proxy/api/ns/db/v1/hello?q=a+%26+b");
        expect(calls[0].init.method).toBe("GET");
        expect(calls[0].init.body).toBeUndefined();
        expect(calls[0].init.redirect).toBe("manual");
        expect(new Headers(calls[0].init.headers).get("x-test")).toBe("yes");
    });

    test("encodes falsy CBOR bodies and decodes native SurrealDB values", async () => {
        const { db, calls } = await connect(() => cbor(new RecordId("user", "ada"), 201));
        const result = await db.api().post("/users", false).value();
        expect(result).toEqual(new RecordId("user", "ada"));
        const body = calls[0].init.body as Blob;
        expect(codec.decode<unknown>(new Uint8Array(await body.arrayBuffer()))).toBe(false);
        const json = await db.api().post("/users", null).value().json();
        expect(json).toBe("user:ada");
    });

    test("sends JSON when requested and decodes JSON responses", async () => {
        const { db, calls } = await connect(
            () =>
                new Response('{"ok":true}', {
                    headers: { "Content-Type": "application/json; charset=utf-8" },
                }),
        );
        expect(
            await db
                .api()
                .post("/users", { name: "Ada" })

                .header("content-type", "application/json")
                .value(),
        ).toEqual({ ok: true });
        expect(await (calls[0].init.body as Blob).text()).toBe('{"name":"Ada"}');
        expect(new Headers(calls[0].init.headers).get("content-type")).toBe("application/json");
    });

    test("returns application errors and never replays a handler returning 401", async () => {
        let resolved = 0;
        const { db, calls } = await connect(
            () =>
                new Response("denied", { status: 401, headers: { "Content-Type": "text/plain" } }),
            { when: "request", resolve: () => `token-${++resolved}` },
        );
        expect(await db.api().get("/private")).toMatchObject({
            body: "denied",
            status: 401,
        });
        await expect(Promise.resolve(db.api().get("/private").value())).rejects.toBeInstanceOf(
            UnsuccessfulApiError,
        );
        expect(calls).toHaveLength(2);
        expect(resolved).toBe(2);
    });

    test("diagnostic wrappers forward API calls and their credentials", async () => {
        const { db, calls } = await connect(() => cbor(true), undefined, true);
        expect(await db.api().get("/hello").as("call-token").value()).toBe(true);
        expect(new Headers(calls[0].init.headers).get("authorization")).toBe("Bearer call-token");
    });

    test("binary responses are returned as bytes", async () => {
        const { db } = await connect(
            () =>
                new Response(new Uint8Array([1, 2, 3]), {
                    headers: { "Content-Type": "application/octet-stream" },
                }),
        );
        expect(await db.api().get("/download").value()).toEqual(new Uint8Array([1, 2, 3]));
    });

    test("empty responses retain a body property", async () => {
        const { db } = await connect(() => new Response(null, { status: 204 }));
        expect(await db.api().get("/empty")).toMatchObject({ body: undefined, status: 204 });
    });

    test("a call credential takes precedence without changing session authentication", async () => {
        const { db, calls } = await connect(() => cbor(true), "session-token");
        await db
            .api()
            .get("/private")
            .header("authorization", "Bearer header-token")
            .as("call-token");
        await db.api().get("/private");
        expect(new Headers(calls[0].init.headers).get("authorization")).toBe("Bearer call-token");
        expect(new Headers(calls[1].init.headers).get("authorization")).toBe(
            "Bearer session-token",
        );
        expect(db.accessToken).toBe("session-token");
    });

    test("rejects GET bodies and dot segments before sending", async () => {
        const { db, calls } = await connect(() => cbor(true));
        await expect(Promise.resolve(db.api().invoke("/hello", { body: 0 }))).rejects.toThrow(
            "cannot have a body",
        );
        await expect(Promise.resolve(db.api().get("/../other"))).rejects.toThrow("dot segments");
        expect(calls).toHaveLength(0);
    });

    test("compile explicitly builds SQL while stream uses HTTP", async () => {
        const { db, calls } = await connect(() => cbor(true));
        expect(db.api().get("/hello").compile().query).toContain("api::invoke");
        const frames = [];
        for await (const frame of db.api().get("/hello").stream()) frames.push(frame);
        expect(frames).toHaveLength(2);
        expect(frames[0].isValue() && frames[0].value).toMatchObject({ body: true, status: 200 });
        expect(frames[1].isDone()).toBe(true);
        expect(calls).toHaveLength(1);
    });

    test("aborted requests are not sent", async () => {
        const { db, calls } = await connect(() => cbor(true));
        const abort = new AbortController();
        const reason = new Error("cancelled");
        abort.abort(reason);
        await expect(Promise.resolve(db.api().get("/hello").signal(abort.signal))).rejects.toBe(
            reason,
        );
        expect(calls).toHaveLength(0);
    });

    test("request timeouts stop waiting even when fetch ignores signals", async () => {
        const { db } = await connect(() => new Promise(() => {}));
        await expect(
            Promise.resolve(db.api().get("/hello").requestTimeout(5)),
        ).rejects.toMatchObject({
            name: "TimeoutError",
        });
    });
});
