import { describe, expect, test } from "bun:test";
import type { QueryChunk } from "surrealdb";
import type { ConnectionController } from "../../../../sdk/src/controller";
import {
    type QueryStreamFrame,
    queryStreamChunks,
} from "../../../../sdk/src/internal/query-stream";
import { DEFAULT_RETRY_OPTIONS } from "../../../../sdk/src/internal/retry";
import { Query } from "../../../../sdk/src/query/query";
import { BoundQuery } from "../../../../sdk/src/utils/bound-query";

/**
 * A query whose chunks come from a fixed script of frames, so the results the
 * SDK builds out of a streamed answer can be compared against the answer the
 * same statements would have produced buffered.
 */
function streamedQuery(frames: QueryStreamFrame[], seen?: QueryChunk<unknown>[]): Query {
    const connection = {
        retry: DEFAULT_RETRY_OPTIONS,
        ready: async () => {},
        query: () => record(frames, seen),
    } as unknown as ConnectionController;

    return new Query(connection, {
        query: new BoundQuery("IRRELEVANT"),
        transaction: undefined,
        session: undefined,
        json: false,
    });
}

// Built afresh per query: the result collectors adopt the arrays a chunk carries, so a shared
// script would be rewritten by the first query which read it.
const twoStatements = (): QueryStreamFrame[] => [
    { stream: "begin", statements: 2 },
    { stream: "rows", index: 0, values: [{ n: 1 }, { n: 2 }] },
    { stream: "rows", index: 0, values: [{ n: 3 }] },
    { stream: "finished", index: 0, time: "1ms", type: "other", single: false },
    { stream: "value", index: 1, value: 42 },
    { stream: "finished", index: 1, time: "1ms", type: "other", single: true },
    { stream: "end", results: 2, time: "2ms" },
];

/** The chunks of a streamed answer, noting each one as it is handed over. */
async function* record(
    frames: QueryStreamFrame[],
    seen?: QueryChunk<unknown>[],
): AsyncGenerator<QueryChunk<unknown>> {
    const chunks = queryStreamChunks(
        (async function* () {
            for (const frame of frames) yield frame;
        })(),
    );

    for await (const chunk of chunks) {
        seen?.push(chunk);
        yield chunk;
    }
}

const failingStatement = (): QueryStreamFrame[] => [
    { stream: "begin", statements: 2 },
    { stream: "rows", index: 0, values: [{ n: 1 }] },
    {
        stream: "finished",
        index: 0,
        time: "1ms",
        error: { code: -32006, message: "An error occurred: nope", kind: "Thrown" },
    },
    { stream: "value", index: 1, value: 7 },
    { stream: "finished", index: 1, time: "1ms", type: "other", single: true },
    { stream: "end", results: 2, time: "2ms" },
];

describe("streamed query results", () => {
    test("collected results are the results the statements produced", async () => {
        const results = await streamedQuery(twoStatements()).collect();

        expect(results).toEqual([[{ n: 1 }, { n: 2 }, { n: 3 }], 42]);
    });

    test("collecting specific statements picks them out of the stream", async () => {
        const results = await streamedQuery(twoStatements()).collect(1);

        expect(results).toEqual([42]);
    });

    test("a failed statement rejects the collected results", async () => {
        await expect(streamedQuery(failingStatement()).collect()).rejects.toThrow("nope");
    });

    test("responses report the failure and drop the rows it retracted", async () => {
        const [first, second] = await streamedQuery(failingStatement()).responses();

        expect(first?.success).toBe(false);
        expect(first).not.toHaveProperty("result");
        expect(second).toMatchObject({ success: true, result: 7 });
    });

    test("streamed frames arrive per value and are closed per statement", async () => {
        const seen: string[] = [];

        for await (const frame of streamedQuery(twoStatements()).stream()) {
            if (frame.isValue()) seen.push(`value:${frame.query}:${frame.isSingle}`);
            if (frame.isDone()) seen.push(`done:${frame.query}`);
            if (frame.isError()) seen.push(`error:${frame.query}`);
        }

        expect(seen).toEqual([
            "value:0:false",
            "value:0:false",
            "value:0:false",
            "done:0",
            "value:1:true",
            "done:1",
        ]);
    });

    test("a failed statement is an error frame after the values it retracts", async () => {
        const seen: string[] = [];

        for await (const frame of streamedQuery(failingStatement()).stream()) {
            if (frame.isValue()) seen.push(`value:${frame.query}`);
            if (frame.isDone()) seen.push(`done:${frame.query}`);
            if (frame.isError()) seen.push(`error:${frame.query}`);
        }

        expect(seen).toEqual(["value:0", "error:0", "value:1", "done:1"]);
    });

    test("collecting a statement does not rewrite the chunks it was built from", async () => {
        const seen: QueryChunk<unknown>[] = [];
        const results = await streamedQuery(twoStatements(), seen).collect();

        expect(results[0]).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }]);

        // Each chunk still carries what it carried when it was handed over, so a consumer which
        // was given one - a diagnostics subscriber, say - is not shown a growing accumulator.
        expect(seen.map((chunk) => chunk.result?.length ?? 0)).toEqual([2, 1, 0, 1]);
    });

    test("a stream which was stopped rather than answered rejects", async () => {
        const stopped = streamedQuery([
            { stream: "begin", statements: 1 },
            { stream: "rows", index: 0, values: [{ n: 1 }] },
            {
                stream: "end",
                results: 0,
                time: "1ms",
                error: { code: -32005, message: "The query was cancelled", kind: "Query" },
            },
        ]);

        await expect(stopped.collect()).rejects.toThrow("cancelled");
    });

    test("a truncated stream rejects rather than returning a prefix", async () => {
        const truncated = streamedQuery([
            { stream: "begin", statements: 1 },
            { stream: "rows", index: 0, values: [{ n: 1 }] },
            { stream: "finished", index: 0, time: "1ms", type: "other", single: false },
        ]);

        await expect(truncated.collect()).rejects.toThrow("terminated");
    });
});
