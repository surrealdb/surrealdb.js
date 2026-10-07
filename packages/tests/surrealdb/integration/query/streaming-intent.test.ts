import { describe, expect, test } from "bun:test";
import getPort from "get-port";
import {
    CborCodec,
    createRemoteEngines,
    type QueryChunk,
    RecordId,
    Surreal,
    Table,
} from "surrealdb";
import {
    createSurreal,
    getEngines,
    SURREAL_BACKEND,
    SURREAL_EXECUTABLE_PATH,
    SURREAL_PASS,
    SURREAL_PORT,
    SURREAL_PROTOCOL,
    SURREAL_USER,
} from "../__helpers__";

/**
 * A query which is simply awaited is streamed only where that is invisible. One which asks for a
 * stream gets one wherever the server can - inside a transaction, and in spite of the driver being
 * configured not to - and is still answered, buffered, by a server which cannot.
 *
 * Whether the server under test streams is asked of it directly, so that every test holds either
 * way and stops asserting on batching only where there is none to assert on.
 */
describe.if(SURREAL_PROTOCOL === "ws")("asking for a stream", () => {
    const RECORDS = 120;

    async function observed(options: { streaming?: boolean } = {}) {
        const chunks: QueryChunk<unknown>[] = [];
        const engines = await getEngines((diagnostic) => {
            if (diagnostic.type !== "query" || diagnostic.phase !== "progress") return;
            if (diagnostic.result.chunk) chunks.push(diagnostic.result.chunk);
        });

        const surreal = await createSurreal({ driverOptions: { engines, ...options } });

        await seed(surreal);

        chunks.length = 0;

        return { surreal, chunks };
    }

    async function seed(surreal: Surreal): Promise<void> {
        await surreal.insert(
            Array.from({ length: RECORDS }, (_, index) => ({
                id: new RecordId("wide", index + 1),
                n: index + 1,
            })),
        );
    }

    /** How many rows a read delivered, and how many chunks it arrived in. */
    async function readStream(
        source: AsyncIterable<{ isValue(): boolean }>,
        chunks: QueryChunk<unknown>[],
    ) {
        chunks.length = 0;

        let rows = 0;

        for await (const frame of source) {
            if (frame.isValue()) rows++;
        }

        return { rows, batches: chunks.filter((chunk) => chunk.kind === "batched").length };
    }

    test("is streamed inside a transaction, where a query merely awaited is not", async () => {
        const { surreal, chunks } = await observed();
        const transaction = await surreal.beginTransaction();

        // Accepted: buffered, so one chunk carrying the whole statement.
        chunks.length = 0;
        const [awaited] = await transaction.query("SELECT * FROM wide ORDER BY id").collect();

        expect(awaited).toBeArrayOfSize(RECORDS);
        expect(chunks).toHaveLength(1);

        // Asked for: the same answer, delivered in batches wherever the server can.
        const asked = await readStream(
            transaction.query("SELECT * FROM wide ORDER BY id").stream(),
            chunks,
        );

        expect(asked.rows).toBe(RECORDS);

        if (await serverStreams()) {
            expect(asked.batches).toBeGreaterThan(0);
        } else {
            expect(asked.batches).toBe(0);
        }

        // And what a stream inside a transaction wrote is what the transaction commits, once the
        // stream has ended.
        for await (const _ of transaction.query("UPDATE wide SET seen = true").stream()) {
            // Read to the end before committing: committing mid-stream commits a prefix.
        }

        await transaction.commit();

        const [seen] = await surreal
            .query("SELECT count() FROM wide WHERE seen = true GROUP ALL")
            .collect();

        expect(seen).toEqual([{ count: RECORDS }]);
    });

    test("is streamed in spite of the driver being configured not to", async () => {
        const { surreal, chunks } = await observed({ streaming: false });

        chunks.length = 0;
        await surreal.query("SELECT * FROM wide ORDER BY id").collect();

        // The driver was configured not to, and a query merely awaited honours that.
        expect(chunks).toHaveLength(1);

        const asked = await readStream(
            surreal.query("SELECT * FROM wide ORDER BY id").stream(),
            chunks,
        );

        expect(asked.rows).toBe(RECORDS);

        if (await serverStreams()) {
            expect(asked.batches).toBeGreaterThan(0);
        }
    });

    test("a builder's stream is asked for as a query's is", async () => {
        const { surreal, chunks } = await observed({ streaming: false });

        const asked = await readStream(surreal.select(new Table("wide")).stream(), chunks);

        expect(asked.rows).toBe(RECORDS);

        if (await serverStreams()) {
            expect(asked.batches).toBeGreaterThan(0);
        }
    });

    test("a server which is known to predate streaming is never asked to stream", async () => {
        const sent: string[] = [];
        const codec = new CborCodec({});

        // Every request the driver writes, as the server receives it.
        class Recording extends WebSocket {
            override send(data: Parameters<WebSocket["send"]>[0]) {
                const request = codec.decode<{ method?: string }>(
                    new Uint8Array(data as ArrayBuffer),
                );

                if (request.method) sent.push(request.method);

                super.send(data);
            }
        }

        const surreal = await createSurreal({ driverOptions: { websocketImpl: Recording } });

        sent.length = 0;

        await surreal.query("RETURN 1").collect();
        await surreal.query("RETURN 2").collect();

        const streamRequests = sent.filter((method) => method === "query_stream");

        if (await serverStreams()) {
            // One per query: the server is asked every time, as it is able to.
            expect(streamRequests).toHaveLength(2);
            expect(sent).not.toContain("query");
        } else {
            // Not even once: the version it reported is enough to know it cannot, which is what
            // asking would have taught, one refused request into every connection.
            expect(streamRequests).toBeEmpty();
            expect(sent.filter((method) => method === "query")).toHaveLength(2);
        }
    });

    describe.if(SURREAL_BACKEND === "remote")("on a server which denies the method", () => {
        test("is still answered, buffered, and so is a query merely awaited", async () => {
            // Only meaningful where the method exists to be denied.
            if (!(await serverStreams())) return;

            await serving(["--deny-rpc", "query_stream"], async (port) => {
                // The premise, asked of the server rather than assumed: it denies the method, which
                // is not the same as not having it.
                expect(await probe(port)).toBe(METHOD_NOT_ALLOWED);

                const chunks: QueryChunk<unknown>[] = [];
                const engines = await getEngines((diagnostic) => {
                    if (diagnostic.type !== "query" || diagnostic.phase !== "progress") return;
                    if (diagnostic.result.chunk) chunks.push(diagnostic.result.chunk);
                });

                const surreal = new Surreal({ engines });

                try {
                    await surreal.connect(`ws://127.0.0.1:${port}/rpc`, {
                        authentication: { username: SURREAL_USER, password: SURREAL_PASS },
                    });
                    await surreal
                        .query("DEFINE NAMESPACE test; USE NS test; DEFINE DATABASE test")
                        .collect();
                    await surreal.use({ namespace: "test", database: "test" });
                    await seed(surreal);

                    chunks.length = 0;

                    const asked = await readStream(
                        surreal.query("SELECT * FROM wide ORDER BY id").stream(),
                        chunks,
                    );

                    // The server cannot stream it, so the rows arrive, buffered, in one chunk.
                    expect(asked.rows).toBe(RECORDS);
                    expect(asked.batches).toBe(0);

                    chunks.length = 0;

                    const [awaited] = await surreal
                        .query("SELECT * FROM wide ORDER BY id")
                        .collect();

                    expect(awaited).toBeArrayOfSize(RECORDS);
                    expect(chunks).toHaveLength(1);
                } finally {
                    await surreal.close();
                }
            });
        });
    });

    describe.if(SURREAL_BACKEND === "remote")("on a server which turns a caller away", () => {
        test("a caller refused is not the server being unable, and may sign in and stream", async () => {
            if (!(await serverStreams())) return;

            // Unauthenticated callers may not run queries, while the method itself is served.
            await serving(["--deny-arbitrary-query", "guest"], async (port) => {
                const sent: string[] = [];
                const codec = new CborCodec({});

                class Recording extends WebSocket {
                    override send(data: Parameters<WebSocket["send"]>[0]) {
                        const request = codec.decode<{ method?: string }>(
                            new Uint8Array(data as ArrayBuffer),
                        );

                        if (request.method) sent.push(request.method);

                        super.send(data);
                    }
                }

                const surreal = new Surreal({
                    engines: createRemoteEngines(),
                    websocketImpl: Recording,
                });

                try {
                    await surreal.connect(`ws://127.0.0.1:${port}/rpc`);

                    // The premise: it is not the method which is denied to everyone, but the guest.
                    expect(await probe(port)).not.toBe(METHOD_NOT_FOUND);

                    sent.length = 0;

                    const refused = (async () => {
                        for await (const _ of surreal.query("RETURN 1").stream()) {
                            // Nothing arrives: the guest is refused.
                        }
                    })();

                    await expect(refused).rejects.toMatchObject({ name: "NotAllowedError" });

                    // Asked for as a stream, and not turned into a buffered query behind its back.
                    expect(sent).toContain("query_stream");
                    expect(sent).not.toContain("query");

                    // The same socket, as someone who is allowed.
                    await surreal.signin({ username: SURREAL_USER, password: SURREAL_PASS });

                    sent.length = 0;

                    const rows: unknown[] = [];

                    for await (const frame of surreal.query("RETURN 2").stream()) {
                        if (frame.isValue()) rows.push(frame.value);
                    }

                    // Nothing was learned about the server from refusing someone: it still streams.
                    expect(rows).toEqual([2]);
                    expect(sent).toContain("query_stream");
                    expect(sent).not.toContain("query");
                } finally {
                    await surreal.close();
                }
            });
        });
    });
});

let support: Promise<boolean> | undefined;

/** Whether the server under test serves the streaming query method, asked of it directly. */
function serverStreams(): Promise<boolean> {
    support ??= probe(Number(SURREAL_PORT)).then((code) => code !== METHOD_NOT_FOUND);
    return support;
}

const METHOD_NOT_FOUND = -32601;
const METHOD_NOT_ALLOWED = -32602;

/** The code the server answers a `query_stream` request with, or nothing if it is answered. */
async function probe(port: number): Promise<number | undefined> {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/rpc`, "json");

    try {
        await new Promise<void>((resolve, reject) => {
            socket.addEventListener("open", () => resolve());
            socket.addEventListener("error", () =>
                reject(new Error("the probe could not connect")),
            );
        });

        const ask = (body: { id: string; method: string; params: unknown[] }) =>
            new Promise<{ id?: string; error?: { code?: number } }>((resolve, reject) => {
                const timer = setTimeout(
                    () => reject(new Error(`${body.id} went unanswered`)),
                    10_000,
                );
                const listener = (event: MessageEvent) => {
                    const response = JSON.parse(event.data as string);

                    if (response.id !== body.id) return;

                    clearTimeout(timer);
                    socket.removeEventListener("message", listener);
                    resolve(response);
                };

                socket.addEventListener("message", listener);
                socket.send(JSON.stringify(body));
            });

        await ask({
            id: "signin",
            method: "signin",
            params: [{ user: SURREAL_USER, pass: SURREAL_PASS }],
        });

        const answer = await ask({ id: "probe", method: "query_stream", params: ["RETURN 1"] });

        return answer.error?.code;
    } finally {
        socket.close();
    }
}

/**
 * Runs `body` against a server of its own, started with `flags`, which is stopped afterwards.
 *
 * The path comes first, as flags such as `--deny-rpc` take a list and would take it for one more
 * item of it.
 */
async function serving(flags: string[], body: (port: number) => Promise<void>): Promise<void> {
    const port = await getPort();
    const server = Bun.spawn([SURREAL_EXECUTABLE_PATH, "start", "memory", ...flags], {
        stdout: "ignore",
        stderr: "ignore",
        env: {
            ...process.env,
            SURREAL_BIND: `127.0.0.1:${port}`,
            SURREAL_USER,
            SURREAL_PASS,
            SURREAL_CAPS_ALLOW_EXPERIMENTAL: "*",
        },
    });

    try {
        const startedAt = Date.now();

        for (;;) {
            try {
                if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) break;
            } catch {
                // Not up yet.
            }

            if (Date.now() - startedAt > 15_000) throw new Error("the server did not start");

            await Bun.sleep(100);
        }

        await body(port);
    } finally {
        server.kill();
        await server.exited;
    }
}
