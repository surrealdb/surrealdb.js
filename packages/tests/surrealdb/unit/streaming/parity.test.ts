import { describe, expect, test } from "bun:test";
import type { LiveMessage, QueryChunk, RpcQueryResult, RpcRequest, Session, Uuid } from "surrealdb";
import { RpcEngine } from "surrealdb";
import type { ConnectionController } from "../../../../sdk/src/controller";
import {
    type QueryStreamFrame,
    queryStreamChunks,
} from "../../../../sdk/src/internal/query-stream";
import { DEFAULT_RETRY_OPTIONS } from "../../../../sdk/src/internal/retry";
import { Query } from "../../../../sdk/src/query/query";
import { BoundQuery } from "../../../../sdk/src/utils/bound-query";

/**
 * The buffered protocol's own translation of a `query` response into chunks, reached through a
 * minimal engine so that what is compared against is the real thing and not a copy of it.
 */
class BufferedEngine extends RpcEngine {
    chunks<T>(responses: RpcQueryResult[]): Iterable<QueryChunk<T>> {
        return this.toChunks<T>(responses);
    }

    override liveQuery(_id: Uuid): AsyncIterable<LiveMessage> {
        throw new Error("not used");
    }

    override send<Method extends string, Params extends unknown[] | undefined, Result>(
        _request: RpcRequest<Method, Params>,
    ): Promise<Result> {
        throw new Error("not used");
    }

    // Unused here; present only so the abstract class can be instantiated.
    override async *query<T>(_query: BoundQuery, _session: Session): AsyncIterable<QueryChunk<T>> {}
}

const engine = new BufferedEngine({
    options: {},
    uniqueId: () => "unused",
    codecs: {} as never,
});

function queryOver(chunks: () => AsyncIterable<QueryChunk<unknown>>): Query {
    const connection = {
        retry: DEFAULT_RETRY_OPTIONS,
        ready: async () => {},
        query: () => chunks(),
    } as unknown as ConnectionController;

    return new Query(connection, {
        query: new BoundQuery("IRRELEVANT"),
        transaction: undefined,
        session: undefined,
        json: false,
    });
}

/** The answer a server gives, as the buffered protocol carries it. */
function buffered(responses: RpcQueryResult[]): Query {
    return queryOver(async function* () {
        yield* engine.chunks<unknown>(responses);
    });
}

/** The same answer, as the streaming protocol carries it. */
function streamed(frames: QueryStreamFrame[]): Query {
    return queryOver(() =>
        queryStreamChunks<unknown>(
            (async function* () {
                for (const frame of frames) yield frame;
            })(),
        ),
    );
}

/** Everything a consumer of `stream()` can observe about each frame. */
async function observe(query: Query): Promise<string[]> {
    const seen: string[] = [];

    for await (const frame of query.stream()) {
        if (frame.isValue()) {
            seen.push(`value:${frame.query}:${frame.isSingle}:${JSON.stringify(frame.value)}`);
        } else if (frame.isDone()) {
            seen.push(`done:${frame.query}:${frame.type}`);
        } else if (frame.isError()) {
            const { error } = frame;

            seen.push(
                `error:${frame.query}:${error.name}:${error.kind}:${error.code}:${error.message}`,
            );
        }
    }

    return seen;
}

describe("a streamed answer is observed as its buffered answer is", () => {
    test("rows, a single value, an empty statement and a failed one", async () => {
        const viaBuffered = await observe(
            buffered([
                {
                    status: "OK",
                    time: "1ms",
                    type: "other",
                    result: [{ n: 1 }, { n: 2 }, { n: 3 }],
                },
                { status: "OK", time: "1ms", type: "other", result: 42 },
                { status: "OK", time: "1ms", type: "other", result: [] },
                { status: "ERR", time: "1ms", result: "boom", kind: "Thrown" },
                { status: "OK", time: "1ms", type: "other", result: "after" },
            ]),
        );

        const viaStreaming = await observe(
            streamed([
                { stream: "begin", statements: 5 },
                // Delivered in batches, as a server does for a large result.
                { stream: "rows", index: 0, values: [{ n: 1 }] },
                { stream: "rows", index: 0, values: [{ n: 2 }, { n: 3 }] },
                { stream: "finished", index: 0, time: "1ms", single: false },
                { stream: "value", index: 1, value: 42 },
                { stream: "finished", index: 1, time: "1ms", single: true },
                { stream: "finished", index: 2, time: "1ms", single: false },
                {
                    stream: "finished",
                    index: 3,
                    time: "1ms",
                    error: { code: -32006, message: "boom", kind: "Thrown" },
                },
                { stream: "value", index: 4, value: "after" },
                { stream: "finished", index: 4, time: "1ms", single: true },
                { stream: "end", results: 5, time: "2ms" },
            ]),
        );

        expect(viaStreaming).toEqual(viaBuffered);
        // And the comparison has something in it: both reported all five statements.
        expect(viaBuffered.filter((entry) => entry.startsWith("done")).length).toBe(4);
        expect(viaBuffered.filter((entry) => entry.startsWith("error")).length).toBe(1);
    });

    test("a statement which streamed rows and one which streamed none", async () => {
        const viaBuffered = await observe(
            buffered([
                { status: "OK", time: "1ms", type: "other", result: [] },
                { status: "OK", time: "1ms", type: "other", result: [{ id: 1 }] },
            ]),
        );

        const viaStreaming = await observe(
            streamed([
                { stream: "begin", statements: 2 },
                { stream: "finished", index: 0, time: "1ms", single: false },
                { stream: "rows", index: 1, values: [{ id: 1 }] },
                { stream: "finished", index: 1, time: "1ms", single: false },
                { stream: "end", results: 2, time: "1ms" },
            ]),
        );

        expect(viaStreaming).toEqual(viaBuffered);
    });

    test("a live query registration", async () => {
        const viaBuffered = await observe(
            buffered([{ status: "OK", time: "1ms", type: "live", result: "d5b7c0ee" }]),
        );

        const viaStreaming = await observe(
            streamed([
                { stream: "begin", statements: 1 },
                { stream: "value", index: 0, value: "d5b7c0ee" },
                { stream: "finished", index: 0, time: "1ms", type: "live", single: true },
                { stream: "end", results: 1, time: "1ms" },
            ]),
        );

        expect(viaStreaming).toEqual(viaBuffered);
        expect(viaBuffered).toContain("done:0:live");
    });
});
