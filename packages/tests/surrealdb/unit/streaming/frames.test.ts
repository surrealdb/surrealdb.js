import { describe, expect, test } from "bun:test";
import type { QueryChunk } from "surrealdb";
import { CallTerminatedError, ThrownError, UnexpectedServerResponseError } from "surrealdb";
import {
    type QueryStreamFrame,
    queryStreamChunks,
} from "../../../../sdk/src/internal/query-stream";

/** Feeds a fixed script of frames to the translator. */
async function collectChunks(frames: QueryStreamFrame[]): Promise<QueryChunk<unknown>[]> {
    const chunks: QueryChunk<unknown>[] = [];

    for await (const chunk of queryStreamChunks(script(frames))) {
        chunks.push(chunk);
    }

    return chunks;
}

async function* script(frames: QueryStreamFrame[]): AsyncGenerator<QueryStreamFrame> {
    for (const frame of frames) {
        yield frame;
    }
}

describe("query stream frames", () => {
    test("rows are chunked as they arrive and closed by their finished frame", async () => {
        const chunks = await collectChunks([
            { stream: "begin", statements: 1 },
            { stream: "rows", index: 0, values: [1, 2] },
            { stream: "rows", index: 0, values: [3] },
            { stream: "finished", index: 0, time: "1.5ms", type: "other", single: false },
            { stream: "end", results: 1, time: "2ms" },
        ]);

        expect(chunks).toHaveLength(3);
        expect(chunks[0]).toMatchObject({ query: 0, batch: 0, kind: "batched", result: [1, 2] });
        expect(chunks[1]).toMatchObject({ query: 0, batch: 1, kind: "batched", result: [3] });
        expect(chunks[2]).toMatchObject({
            query: 0,
            batch: 2,
            kind: "batched-final",
            result: [],
            type: "other",
        });
        expect(chunks[2]?.stats?.duration.nanoseconds).toBe(1_500_000n);
    });

    test("a single value is held back until its finished frame names it as one", async () => {
        const chunks = await collectChunks([
            { stream: "begin", statements: 1 },
            { stream: "value", index: 0, value: 42 },
            { stream: "finished", index: 0, time: "1ms", type: "other", single: true },
            { stream: "end", results: 1, time: "1ms" },
        ]);

        expect(chunks).toHaveLength(1);
        expect(chunks[0]).toMatchObject({ query: 0, kind: "single", result: [42] });
    });

    test("a single statement which sent no value produced NONE", async () => {
        const chunks = await collectChunks([
            { stream: "begin", statements: 1 },
            { stream: "finished", index: 0, time: "1ms", type: "other", single: true },
            { stream: "end", results: 1, time: "1ms" },
        ]);

        expect(chunks).toHaveLength(1);
        expect(chunks[0]?.kind).toBe("single");
        expect(chunks[0]?.result).toEqual([undefined]);
    });

    test("statements keep their own batch numbering while interleaved", async () => {
        const chunks = await collectChunks([
            { stream: "begin", statements: 2 },
            { stream: "rows", index: 0, values: ["a"] },
            { stream: "rows", index: 1, values: ["b"] },
            { stream: "rows", index: 0, values: ["c"] },
            { stream: "finished", index: 1, time: "1ms", type: "other", single: false },
            { stream: "finished", index: 0, time: "1ms", type: "other", single: false },
            { stream: "end", results: 2, time: "1ms" },
        ]);

        expect(chunks.map((chunk) => [chunk.query, chunk.batch])).toEqual([
            [0, 0],
            [1, 0],
            [0, 1],
            [1, 1],
            [0, 2],
        ]);
    });

    test("a failed statement is reported as an error rather than a result", async () => {
        const chunks = await collectChunks([
            { stream: "begin", statements: 1 },
            { stream: "rows", index: 0, values: [1] },
            {
                stream: "finished",
                index: 0,
                time: "1ms",
                error: { code: -32000, message: "it broke", kind: "Internal" },
            },
            { stream: "end", results: 1, time: "1ms" },
        ]);

        expect(chunks).toHaveLength(2);
        expect(chunks[0]).toMatchObject({ query: 0, kind: "batched", result: [1] });
        expect(chunks[1]?.error?.message).toBe("it broke");
        expect(chunks[1]?.result).toBeUndefined();
    });

    test("a statement's failure is reported as the buffered protocol reports it", async () => {
        const chunks = await collectChunks([
            { stream: "begin", statements: 1 },
            {
                stream: "finished",
                index: 0,
                time: "1ms",
                error: {
                    code: -32006,
                    message: "An error occurred: nope",
                    kind: "Thrown",
                    details: null,
                },
            },
            { stream: "end", results: 1, time: "1ms" },
        ]);

        const error = chunks[0]?.error;

        expect(error).toBeInstanceOf(ThrownError);
        expect(error?.kind).toBe("Thrown");
        expect(error?.message).toBe("An error occurred: nope");
        // A statement's failure carries no wire code on the buffered protocol, so it carries
        // none here either: the same failing query must not report a different code because
        // its answer happened to be streamed.
        expect(error?.code).toBe(0);
    });

    test("a failed stream retracts every statement which never finished, then throws", async () => {
        const chunks: QueryChunk<unknown>[] = [];
        let thrown: unknown;

        try {
            for await (const chunk of queryStreamChunks(
                script([
                    { stream: "begin", statements: 2 },
                    { stream: "rows", index: 0, values: [1] },
                    { stream: "finished", index: 0, time: "1ms", type: "other", single: false },
                    { stream: "rows", index: 1, values: [2] },
                    {
                        stream: "end",
                        results: 1,
                        time: "1ms",
                        error: { code: -32000, message: "stopped", kind: "Internal" },
                    },
                ]),
            )) {
                chunks.push(chunk);
            }
        } catch (error) {
            thrown = error;
        }

        // The statement which finished stands; the one which did not is retracted.
        expect(chunks.filter((chunk) => chunk.error).map((chunk) => chunk.query)).toEqual([1]);
        expect((thrown as Error | undefined)?.message).toBe("stopped");
    });

    test("a failed stream also retracts a statement which had sent a single value", async () => {
        const chunks: QueryChunk<unknown>[] = [];
        let thrown: unknown;

        try {
            for await (const chunk of queryStreamChunks(
                script([
                    { stream: "begin", statements: 1 },
                    { stream: "value", index: 0, value: "d5b7c0ee" },
                    {
                        stream: "end",
                        results: 0,
                        time: "1ms",
                        error: { code: -32000, message: "stopped", kind: "Internal" },
                    },
                ]),
            )) {
                chunks.push(chunk);
            }
        } catch (error) {
            thrown = error;
        }

        // The value was never final, so it is retracted rather than delivered.
        expect(chunks).toHaveLength(1);
        expect(chunks[0]).toMatchObject({ query: 0, kind: "batched-final" });
        expect(chunks[0]?.error?.message).toBe("stopped");
        expect(chunks[0]?.result).toBeUndefined();
        expect((thrown as Error | undefined)?.message).toBe("stopped");
    });

    test("the statement count on the begin frame is only an upper bound", async () => {
        // Control flow such as a RETURN inside a BEGIN block skips the tail, so fewer statements
        // finish than were announced, and the stream still ended cleanly.
        const chunks = await collectChunks([
            { stream: "begin", statements: 3 },
            { stream: "value", index: 0, value: 1 },
            { stream: "finished", index: 0, time: "1ms", type: "other", single: true },
            { stream: "end", results: 1, time: "1ms" },
        ]);

        expect(chunks).toHaveLength(1);
        expect(chunks.map((chunk) => chunk.query)).toEqual([0]);
    });

    test("a statement index this SDK cannot represent fails the query", async () => {
        const attempt = collectChunks([
            { stream: "begin", statements: 1 },
            { stream: "rows", index: -1, values: [1] },
        ]);

        await expect(attempt).rejects.toBeInstanceOf(UnexpectedServerResponseError);
    });

    test("frames running out without a terminal frame fails the query", async () => {
        const attempt = collectChunks([
            { stream: "begin", statements: 1 },
            { stream: "rows", index: 0, values: [1] },
        ]);

        await expect(attempt).rejects.toBeInstanceOf(CallTerminatedError);
    });

    test("nothing which arrives after a statement finished is acted on", async () => {
        const chunks = await collectChunks([
            { stream: "begin", statements: 1 },
            { stream: "rows", index: 0, values: [1] },
            { stream: "finished", index: 0, time: "1ms", type: "other", single: false },
            { stream: "rows", index: 0, values: [2] },
            {
                stream: "finished",
                index: 0,
                time: "1ms",
                error: { code: -32000, message: "too late", kind: "Internal" },
            },
            { stream: "end", results: 1, time: "1ms" },
        ]);

        expect(chunks).toHaveLength(2);
        expect(chunks[0]?.result).toEqual([1]);
        expect(chunks[1]).toMatchObject({ kind: "batched-final" });
        expect(chunks.some((chunk) => chunk.error)).toBe(false);
    });

    test("an unrecognised frame kind is skipped rather than fatal", async () => {
        const chunks = await collectChunks([
            { stream: "begin", statements: 1 },
            { stream: "hypothetical" } as unknown as QueryStreamFrame,
            { stream: "finished", index: 0, time: "1ms", type: "other", single: false },
            { stream: "end", results: 1, time: "1ms" },
        ]);

        expect(chunks).toHaveLength(1);
        expect(chunks[0]?.kind).toBe("batched-final");
    });

    test("an unreadable duration leaves the statistics out instead of failing", async () => {
        const chunks = await collectChunks([
            { stream: "begin", statements: 1 },
            { stream: "finished", index: 0, time: "later", type: "other", single: false },
            { stream: "end", results: 1, time: "1ms" },
        ]);

        expect(chunks[0]?.stats).toBeUndefined();
    });

    test("a statement with no type of its own leaves the chunk's type unset", async () => {
        // The buffered protocol leaves it unset for an ordinary statement, and the chunks the two
        // paths produce have to be the same chunks.
        const chunks = await collectChunks([
            { stream: "begin", statements: 1 },
            { stream: "finished", index: 0, time: "1ms", single: false },
            { stream: "end", results: 1, time: "1ms" },
        ]);

        expect(chunks[0]).not.toHaveProperty("type", "other");
        expect(chunks[0]?.type).toBeUndefined();
    });

    test("the live query type of a statement is carried through", async () => {
        const chunks = await collectChunks([
            { stream: "begin", statements: 1 },
            { stream: "value", index: 0, value: "d5b7c0ee" },
            { stream: "finished", index: 0, time: "1ms", type: "live", single: true },
            { stream: "end", results: 1, time: "1ms" },
        ]);

        expect(chunks[0]?.type).toBe("live");
    });
});
