import { afterEach, describe, expect, test } from "bun:test";
import {
    BoundQuery,
    dedupeTrace,
    type QueryChunk,
    type QueryTrace,
    RecordId,
    ThrownError,
    Uuid,
    WebSocketEngine,
} from "surrealdb";
import type { ConnectionController } from "../../../../sdk/src/controller";
import {
    type QueryStreamFrame as EmbeddedFrame,
    framesToChunks,
} from "../../../../sdk/src/engine/stream";
import {
    type QueryStreamFrame,
    queryStreamChunks,
} from "../../../../sdk/src/internal/query-stream";
import { DEFAULT_RETRY_OPTIONS } from "../../../../sdk/src/internal/retry";
import {
    mergeTraces,
    normalizeTraceKinds,
    parseTrace,
    queryParams,
} from "../../../../sdk/src/internal/trace";
import { Query } from "../../../../sdk/src/query/query";
import { MockSocket, mockContext, mockState } from "../__helpers__/mock-socket";

type Chunk = QueryChunk<unknown>;

const post1 = new RecordId("post", 1);
const post2 = new RecordId("post", 2);
const tagged = (key: string) => new RecordId("tagged", key);
const rust = new RecordId("tag", "rust");
const tobie = new RecordId("person", "tobie");

/** One wire relation, as the server sends it: `[in, edge, out]`. */
const wireRelation = (from: RecordId, edge: RecordId, out: RecordId) => [from, edge, out];

async function all<T>(source: AsyncIterable<T>): Promise<T[]> {
    const seen: T[] = [];

    for await (const item of source) seen.push(item);

    return seen;
}

async function* script<T>(items: T[]): AsyncGenerator<T> {
    for (const item of items) yield item;
}

describe("trace kinds", () => {
    test("none asks for every kind, in a fixed order", () => {
        expect(normalizeTraceKinds([])).toEqual([
            "relations",
            "references",
            "links",
            "variables",
            "subscriptions",
        ]);
    });

    test("named kinds are ordered and not repeated", () => {
        expect(normalizeTraceKinds(["links", "relations", "links"])).toEqual([
            "relations",
            "links",
        ]);
    });

    test("an unknown kind is refused rather than sent", () => {
        expect(() => normalizeTraceKinds(["relations", "edges"])).toThrow(TypeError);
    });

    test("a call asks for them in its options, and one which does not sends none", () => {
        const query = new BoundQuery("SELECT * FROM post", { a: 1 });

        expect(queryParams(query, "query")).toEqual(["SELECT * FROM post", { a: 1 }]);
        expect(queryParams(query, "query", { trace: [] })).toEqual([
            "SELECT * FROM post",
            { a: 1 },
        ]);
        expect(queryParams(query, "query", { trace: ["links"] })).toEqual([
            "SELECT * FROM post",
            { a: 1 },
            { trace: ["links"] },
        ]);
        // The `gql` method has no options.
        expect(queryParams(query, "gql", { trace: ["links"] })).toEqual([
            "SELECT * FROM post",
            { a: 1 },
        ]);
    });
});

describe("parsing a trace", () => {
    test("tuples become named entries, and what is empty is left out", () => {
        const trace = parseTrace({
            relations: [
                wireRelation(post1, tagged("a"), rust),
                [undefined, tagged("b"), undefined],
            ],
            references: [[post1, post2]],
            links: [[post1, "author", tobie]],
            variables: { x: 1 },
            subscriptions: [Uuid.v4()],
            partial: true,
            truncated: ["links", "nonsense"],
        });

        expect(trace?.relations).toEqual([
            { in: post1, edge: tagged("a"), out: rust },
            { in: undefined, edge: tagged("b"), out: undefined },
        ]);
        expect(trace?.references).toEqual([{ referrer: post1, referenced: post2 }]);
        expect(trace?.links).toEqual([{ record: post1, field: "author", target: tobie }]);
        expect(trace?.variables).toEqual({ x: 1 });
        expect(trace?.subscriptions).toHaveLength(1);
        expect(trace?.partial).toBe(true);
        expect(trace?.truncated).toEqual(["links"]);
    });

    test("nothing, or nothing in it, is no trace", () => {
        expect(parseTrace(undefined)).toBeUndefined();
        expect(parseTrace(null)).toBeUndefined();
        expect(parseTrace([])).toBeUndefined();
        expect(parseTrace({ relations: [], variables: {}, partial: false })).toBeUndefined();
    });
});

describe("collecting and deduplicating", () => {
    const a: QueryTrace = {
        relations: [{ in: post1, edge: tagged("a"), out: rust }],
        variables: { x: 1 },
        truncated: ["links"],
    };
    const b: QueryTrace = {
        relations: [{ in: post1, edge: tagged("a"), out: rust }],
        variables: { y: 2 },
        partial: true,
    };

    test("merging keeps everything which was sent, in order, and changes neither", () => {
        const merged = mergeTraces(a, b);

        expect(merged?.relations).toHaveLength(2);
        expect(merged?.variables).toEqual({ x: 1, y: 2 });
        expect(merged?.partial).toBe(true);
        expect(merged?.truncated).toEqual(["links"]);
        expect(a.relations).toHaveLength(1);
        expect(mergeTraces(undefined, b)).toBe(b);
        expect(mergeTraces(a, undefined)).toBe(a);
    });

    test("deduplicating keeps the first of each entry, by its ids", () => {
        const deduped = dedupeTrace({
            relations: [
                { in: post1, edge: tagged("a"), out: rust },
                { in: post1, edge: tagged("a"), out: rust },
                { in: post2, edge: tagged("b"), out: rust },
                { in: undefined, edge: tagged("a"), out: rust },
            ],
            links: [
                { record: post1, field: "author", target: tobie },
                { record: post1, field: "author", target: tobie },
                { record: post1, field: "editor", target: tobie },
            ],
            references: [
                { referrer: post1, referenced: post2 },
                { referrer: post1, referenced: post2 },
            ],
        });

        expect(deduped.relations).toHaveLength(3);
        expect(deduped.links).toHaveLength(2);
        expect(deduped.references).toHaveLength(1);
    });
});

describe("trace on streamed frames", () => {
    test("rides on the chunk of the rows frame it came with", async () => {
        const frames: QueryStreamFrame[] = [
            { stream: "begin", statements: 1 },
            {
                stream: "rows",
                index: 0,
                values: [1, 2],
                trace: { relations: [wireRelation(post1, tagged("a"), rust)] },
            },
            { stream: "rows", index: 0, values: [3] },
            {
                stream: "finished",
                index: 0,
                time: "1ms",
                type: "other",
                single: false,
                trace: { variables: { x: 1 }, partial: true },
            },
            { stream: "end", results: 1, time: "1ms" },
        ];

        const chunks = await all(queryStreamChunks(script(frames)));

        expect(chunks[0]?.trace?.relations).toEqual([{ in: post1, edge: tagged("a"), out: rust }]);
        // A frame which sent none has none, rather than inheriting the last one.
        expect(chunks[1]).not.toHaveProperty("trace");
        expect(chunks[2]?.trace).toEqual({ variables: { x: 1 }, partial: true });
    });

    test("a single value and its finished frame are one chunk, so both ride on it", async () => {
        const frames: QueryStreamFrame[] = [
            { stream: "begin", statements: 1 },
            { stream: "value", index: 0, value: 7, trace: { variables: { x: 1 } } },
            {
                stream: "finished",
                index: 0,
                time: "1ms",
                single: true,
                trace: { variables: { y: 2 } },
            },
            { stream: "end", results: 1, time: "1ms" },
        ];

        const [chunk] = await all(queryStreamChunks(script(frames)));

        expect(chunk?.kind).toBe("single");
        expect(chunk?.trace?.variables).toEqual({ x: 1, y: 2 });
    });

    test("a chunk of a query which asked for no trace has no trace key at all", async () => {
        const frames: QueryStreamFrame[] = [
            { stream: "begin", statements: 1 },
            { stream: "rows", index: 0, values: [1] },
            { stream: "finished", index: 0, time: "1ms", single: false },
            { stream: "end", results: 1, time: "1ms" },
        ];

        for (const chunk of await all(queryStreamChunks(script(frames)))) {
            expect(chunk).not.toHaveProperty("trace");
        }
    });

    test("an embedded engine's frames carry it the same way", async () => {
        const chunks = await all(
            framesToChunks(
                script<EmbeddedFrame>([
                    { stream: "begin", statements: 2 },
                    {
                        stream: "rows",
                        index: 0,
                        values: [1],
                        trace: { links: [[post1, "author", tobie]] },
                    },
                    {
                        stream: "finished",
                        index: 0,
                        time: "1ms",
                        single: false,
                        trace: { partial: true },
                    },
                    { stream: "value", index: 1, value: 2, trace: { variables: { a: 1 } } },
                    {
                        stream: "finished",
                        index: 1,
                        time: "1ms",
                        single: true,
                        trace: { variables: { b: 2 } },
                    },
                    { stream: "end", results: 2, time: "2ms" },
                ]),
            ),
        );

        expect(chunks[0]?.trace?.links).toEqual([
            { record: post1, field: "author", target: tobie },
        ]);
        expect(chunks[1]?.trace).toEqual({ partial: true });
        expect(chunks[2]?.trace?.variables).toEqual({ a: 1, b: 2 });
    });
});

describe("trace on a websocket engine", () => {
    let engine: WebSocketEngine | undefined;

    afterEach(async () => {
        await engine?.close();
        engine = undefined;
        MockSocket.reset();
    });

    async function open(streaming: boolean): Promise<WebSocketEngine> {
        const opened = new WebSocketEngine(mockContext({ streaming }));
        engine = opened;

        const connected = new Promise<void>((resolve) => {
            const off = opened.subscribe("connected", () => {
                off();
                resolve();
            });
        });

        opened.open(mockState(false));
        await connected;

        return opened;
    }

    test("asking for one sends it as an option of the streaming request", async () => {
        const started = await open(true);

        MockSocket.handler = (socket, request) => {
            if (request.method !== "query_stream") return;

            for (const frame of [
                { stream: "begin", statements: 1 },
                {
                    stream: "rows",
                    index: 0,
                    values: [{ id: post1 }],
                    trace: { relations: [wireRelation(post1, tagged("a"), rust)] },
                },
                { stream: "finished", index: 0, time: "1ms", type: "other", single: false },
                { stream: "end", results: 1, time: "1ms" },
            ]) {
                queueMicrotask(() => socket.respond({ id: request.id, result: frame }));
            }
        };

        const chunks = await all(
            started.query(new BoundQuery("SELECT * FROM post"), Uuid.v4(), undefined, {
                stream: true,
                trace: ["relations"],
            }),
        );

        const [request] = MockSocket.current.requestsFor("query_stream");

        expect(request?.params).toEqual(["SELECT * FROM post", {}, { trace: ["relations"] }]);
        expect(chunks[0]?.trace?.relations).toEqual([{ in: post1, edge: tagged("a"), out: rust }]);
    });

    test("a query which asks for none sends no options, as before", async () => {
        const started = await open(true);

        MockSocket.handler = (socket, request) => {
            if (request.method !== "query_stream") return;

            for (const frame of [
                { stream: "begin", statements: 0 },
                { stream: "end", results: 0, time: "1ms" },
            ]) {
                queueMicrotask(() => socket.respond({ id: request.id, result: frame }));
            }
        };

        await all(started.query(new BoundQuery("SELECT * FROM post"), Uuid.v4()));

        const [request] = MockSocket.current.requestsFor("query_stream");

        expect(request?.params).toEqual(["SELECT * FROM post", {}]);
    });

    test("a buffered answer carries the trace of each result", async () => {
        const started = await open(false);

        MockSocket.handler = (socket, request) => {
            if (request.method !== "query") return;

            socket.respond({
                id: request.id,
                result: [
                    {
                        status: "OK",
                        time: "1ms",
                        type: "other",
                        result: [{ id: post1 }],
                        trace: { relations: [wireRelation(post1, tagged("a"), rust)] },
                    },
                    { status: "OK", time: "1ms", type: "other", result: 1 },
                ],
            });
        };

        const chunks = await all(
            started.query(new BoundQuery("SELECT * FROM post; RETURN 1"), Uuid.v4(), undefined, {
                trace: ["relations"],
            }),
        );

        const [request] = MockSocket.current.requestsFor("query");

        expect(request?.params).toEqual([
            "SELECT * FROM post; RETURN 1",
            {},
            { trace: ["relations"] },
        ]);
        expect(chunks[0]?.trace?.relations).toEqual([{ in: post1, edge: tagged("a"), out: rust }]);
        expect(chunks[1]).not.toHaveProperty("trace");
    });
});

describe("Query.trace()", () => {
    const chunk = (over: Partial<Chunk> & Pick<Chunk, "query" | "kind">): Chunk => ({
        batch: 0,
        type: "other",
        ...over,
    });

    function scripted(chunks: Chunk[], options: { dialect?: "sql" | "gql" } = {}) {
        const asked: unknown[] = [];

        const connection = {
            retry: DEFAULT_RETRY_OPTIONS,
            ready: async () => {},
            query: (_q: unknown, _s: unknown, _t: unknown, request?: unknown) => {
                asked.push(request);

                return script(chunks);
            },
            gql: () => script(chunks),
        } as unknown as ConnectionController;

        const query = new Query(connection, {
            query: new BoundQuery("IRRELEVANT"),
            transaction: undefined,
            session: undefined,
            json: false,
            ...options,
        });

        return { query, asked };
    }

    const first: QueryTrace = { relations: [{ in: post1, edge: tagged("a"), out: rust }] };
    const again: QueryTrace = {
        relations: [
            { in: post1, edge: tagged("a"), out: rust },
            { in: post2, edge: tagged("b"), out: rust },
        ],
    };
    const closing: QueryTrace = { variables: { x: 1 }, partial: true };

    const streamed = (): Chunk[] => [
        chunk({ query: 0, kind: "batched", result: ["a", "b"], trace: first }),
        chunk({ query: 0, kind: "batched", result: ["c"], trace: again }),
        chunk({ query: 0, kind: "batched-final", result: [], trace: closing }),
    ];

    test("asks the engine for the kinds, in order, and for every kind with none named", async () => {
        const named = scripted([]);
        await all(named.query.trace("links", "relations").stream());
        expect(named.asked[0]).toMatchObject({ trace: ["relations", "links"] });

        const every = scripted([]);
        await all(every.query.trace().stream());
        expect(every.asked[0]).toMatchObject({
            trace: ["relations", "references", "links", "variables", "subscriptions"],
        });

        const none = scripted([]);
        await all(none.query.stream());
        expect(none.asked[0]).not.toHaveProperty("trace");
    });

    test("a kind which does not exist is refused", () => {
        const { query } = scripted([]);

        expect(() => query.trace("edges" as never)).toThrow(TypeError);
    });

    test("is refused for a query which is not SurrealQL", async () => {
        const { query } = scripted([], { dialect: "gql" });

        await expect(all(query.trace().stream())).rejects.toThrow(TypeError);
    });

    test("stream() puts it on the first value frame of a batch, and on done when no rows came", async () => {
        const { query } = scripted(streamed());
        const frames = await all(query.trace().stream());

        expect(frames.map((f) => (f.isValue() ? `v:${f.value}` : "done"))).toEqual([
            "v:a",
            "v:b",
            "v:c",
            "done",
        ]);

        const traces = frames.map((f) => (f.isValue() || f.isDone() ? f.trace : undefined));

        // As the frames of the server were sent: nothing merged, nothing deduplicated.
        expect(traces[0]).toBe(first);
        expect(traces[1]).toBeUndefined();
        expect(traces[2]).toBe(again);
        expect(traces[3]).toBe(closing);
    });

    test("stream() puts the trace of a single value on its value frame", async () => {
        const { query } = scripted([
            chunk({ query: 0, kind: "single", result: [42], trace: closing }),
        ]);
        const [value, done] = await all(query.trace().stream());

        expect(value?.isValue() && value.trace).toBe(closing);
        expect(done?.isDone() && done.trace).toBeUndefined();
    });

    test("responses() collects what every frame of a statement sent, as it was sent", async () => {
        const { query } = scripted(streamed());
        const [response] = await query.trace().responses();

        expect(response?.success).toBe(true);
        if (!response?.success) return;

        expect(response.result).toEqual(["a", "b", "c"]);
        expect(response.trace?.relations).toHaveLength(3);
        expect(response.trace?.variables).toEqual({ x: 1 });
        expect(response.trace?.partial).toBe(true);
        // What the caller may then do about the repeat is theirs to decide.
        expect(dedupeTrace(response.trace as QueryTrace).relations).toHaveLength(2);
    });

    test("responses() has none for a statement which failed, and none for one which has none", async () => {
        const { query } = scripted([
            chunk({ query: 0, kind: "batched", result: [1], trace: first }),
            chunk({
                query: 0,
                kind: "batched-final",
                error: new ThrownError({ kind: "Thrown", message: "boom" }),
            }),
            chunk({ query: 1, kind: "batched-final", result: [2] }),
        ]);
        const [failed, plain] = await query.trace().responses();

        expect(failed?.success).toBe(false);
        expect(failed).not.toHaveProperty("trace");
        expect(plain?.success && plain).not.toHaveProperty("trace");
    });

    test("statements() carries it on each statement once it is final", async () => {
        const { query } = scripted([
            ...streamed(),
            chunk({ query: 1, kind: "single", result: [1], trace: closing }),
            chunk({ query: 2, kind: "batched-final", result: [3] }),
        ]);
        const statements = await all(query.trace().statements());

        expect(statements[0]?.trace?.relations).toHaveLength(3);
        expect(statements[0]?.trace?.variables).toEqual({ x: 1 });
        expect(statements[1]?.trace).toBe(closing);
        expect(statements[2]).not.toHaveProperty("trace");
    });

    test("a query which asked for none returns the same frames and responses as ever", async () => {
        const { query } = scripted([
            chunk({ query: 0, kind: "batched", result: [1] }),
            chunk({ query: 0, kind: "batched-final", result: [] }),
        ]);
        const frames = await all(query.stream());

        for (const frame of frames) {
            if (frame.isValue() || frame.isDone()) expect(frame.trace).toBeUndefined();
        }

        const [response] = await query.responses();
        expect(response).not.toHaveProperty("trace");
    });
});
