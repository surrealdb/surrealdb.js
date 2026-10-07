import { describe, expect, test } from "bun:test";
import type { QueryChunk } from "surrealdb";
import { RecordId, ThrownError } from "surrealdb";
import type { ConnectionController } from "../../../../sdk/src/controller";
import { DEFAULT_RETRY_OPTIONS } from "../../../../sdk/src/internal/retry";
import { Query } from "../../../../sdk/src/query/query";
import { BoundQuery } from "../../../../sdk/src/utils/bound-query";
import { RowStream } from "../../../../sdk/src/utils/stream-views";

type Chunk = QueryChunk<unknown>;

const rows = (query: number, ...values: unknown[]): Chunk => ({
    query,
    batch: 0,
    kind: "batched",
    result: values,
});

const last = (query: number, ...values: unknown[]): Chunk => ({
    query,
    batch: 0,
    kind: "batched-final",
    result: values,
    type: "other",
});

const single = (query: number, value: unknown): Chunk => ({
    query,
    batch: 0,
    kind: "single",
    result: [value],
    type: "other",
});

const failed = (query: number, message: string): Chunk => ({
    query,
    batch: 0,
    kind: "batched-final",
    error: new ThrownError({ kind: "Thrown", message }),
});

/**
 * A query over a script of chunks, which also records what the engine was asked and how the
 * iterator it handed back was left.
 */
function scripted(chunks: Chunk[], options: { json?: boolean } = {}) {
    const state = {
        opened: 0,
        returned: 0,
        asked: [] as { stream?: boolean }[],
    };

    const connection = {
        retry: DEFAULT_RETRY_OPTIONS,
        ready: async () => {},
        query: (_q: unknown, _s: unknown, _t: unknown, request?: { stream?: boolean }) => {
            state.opened++;
            state.asked.push(request ?? {});

            return {
                [Symbol.asyncIterator]() {
                    let next = 0;

                    return {
                        async next(): Promise<IteratorResult<Chunk>> {
                            const chunk = chunks[next++];

                            return chunk
                                ? { value: chunk, done: false }
                                : { value: undefined, done: true };
                        },
                        async return(): Promise<IteratorResult<Chunk>> {
                            state.returned++;
                            return { value: undefined, done: true };
                        },
                    };
                },
            };
        },
    } as unknown as ConnectionController;

    const query = new Query(connection, {
        query: new BoundQuery("IRRELEVANT"),
        transaction: undefined,
        session: undefined,
        json: options.json ?? false,
    });

    return { query, state };
}

async function all<T>(source: AsyncIterable<T>): Promise<T[]> {
    const seen: T[] = [];

    for await (const item of source) seen.push(item);

    return seen;
}

describe("rows()", () => {
    test("are the rows of every statement, in order, as the chunks arrive", async () => {
        const { query } = scripted([
            rows(0, 1, 2),
            rows(0, 3),
            last(0),
            single(1, "one"),
            last(2, 4, 5),
        ]);

        expect(await all(query.rows())).toEqual([1, 2, 3, "one", 4, 5]);
    });

    test("a statement which is NONE is no row, but a NONE inside a list is", async () => {
        const { query } = scripted([
            // `LET $a = 1`
            single(0, undefined),
            // `RETURN [NONE, 1, NONE]`: a list, whose elements are rows even when they are NONE.
            last(1, undefined, 1, undefined),
            // `RETURN NULL` is a value, not an absence.
            single(2, null),
        ]);

        expect(await all(query.rows())).toEqual([undefined, 1, undefined, null]);
    });

    test("a failed statement throws after the rows which preceded it", async () => {
        const { query } = scripted([
            rows(0, 1, 2),
            last(0),
            rows(1, 3),
            failed(1, "nope"),
            last(2, 9),
        ]);
        const seen: unknown[] = [];
        let thrown: unknown;

        try {
            for await (const row of query.rows()) seen.push(row);
        } catch (error) {
            thrown = error;
        }

        // Provisional: 3 was yielded for the statement which then failed, and is void.
        expect(seen).toEqual([1, 2, 3]);
        expect(thrown).toBeInstanceOf(ThrownError);
        expect((thrown as Error).message).toBe("nope");
    });

    test("a failure also stops the query, rather than leaving it running", async () => {
        const { query, state } = scripted([failed(0, "nope"), last(1, 1)]);

        await expect(all(query.rows())).rejects.toThrow("nope");
        expect(state.returned).toBe(1);
    });

    test("parse is applied to each row as it arrives", async () => {
        const { query } = scripted([rows(0, 1, 2), single(1, 3)]);

        expect(await all(query.rows((row) => `n${row}`))).toEqual(["n1", "n2", "n3"]);
    });

    test("a parse which throws ends the iteration and stops the query", async () => {
        const { query, state } = scripted([rows(0, 1, 2, 3), last(0)]);
        const seen: unknown[] = [];

        const attempt = (async () => {
            for await (const row of query.rows((value) => {
                if (value === 2) throw new Error("not a person");

                return value;
            })) {
                seen.push(row);
            }
        })();

        await expect(attempt).rejects.toThrow("not a person");
        expect(seen).toEqual([1]);
        expect(state.returned).toBe(1);
    });

    test("in json mode each row is made JSON compatible before it is parsed", async () => {
        const id = new RecordId("person", 1);
        const { query } = scripted([rows(0, { id })], { json: true });

        const [row] = await all(query.json().rows());

        expect(row).toEqual({ id: "person:1" });
    });

    test("nothing is sent until the first read, and each view sends its own", async () => {
        const { query, state } = scripted([last(0, 1)]);

        const first = query.rows();
        query.rows();

        expect(state.opened).toBe(0);

        await all(first);

        expect(state.opened).toBe(1);

        await all(query.rows());

        expect(state.opened).toBe(2);
    });

    test("asks for a stream", async () => {
        const { query, state } = scripted([last(0, 1)]);

        await all(query.rows());

        expect(state.asked[0]?.stream).toBe(true);
    });

    test("is finished once it has been read to the end", async () => {
        const { query, state } = scripted([last(0, 1)]);
        const view = query.rows();

        await all(view);

        expect(await view.next()).toEqual({ value: undefined, done: true });
        // Reading to the end lets go of the request, once.
        expect(state.returned).toBe(1);
    });
});

describe("leaving a view", () => {
    test("breaking out of the loop stops the query", async () => {
        const { query, state } = scripted([rows(0, 1, 2, 3), last(0)]);

        for await (const _ of query.rows()) break;

        expect(state.returned).toBe(1);
    });

    test("await using stops the query, and may be done again without harm", async () => {
        const { query, state } = scripted([rows(0, 1, 2, 3), last(0)]);

        {
            await using view = query.rows();

            await view.next();
        }

        expect(state.returned).toBe(1);

        const again = query.rows();

        await again.next();
        await again[Symbol.asyncDispose]();
        await again[Symbol.asyncDispose]();

        expect(state.returned).toBe(2);
    });

    test("a view which was never read opens nothing and has nothing to stop", async () => {
        const { query, state } = scripted([last(0, 1)]);
        const view = query.rows();

        await view.return();

        expect(state.opened).toBe(0);
        expect(state.returned).toBe(0);
        expect(await view.next()).toEqual({ value: undefined, done: true });
    });

    test("a read parked on the server is released at once, not waited out", async () => {
        // The server is not going to send anything, as when a query is in the middle of a SLEEP.
        let release: (() => void) | undefined;
        const parked = new Promise<void>((resolve) => {
            release = resolve;
        });

        const connection = {
            retry: DEFAULT_RETRY_OPTIONS,
            ready: async () => {},
            query: () => ({
                [Symbol.asyncIterator]() {
                    return {
                        async next(): Promise<IteratorResult<Chunk>> {
                            await parked;
                            return { value: undefined, done: true };
                        },
                        async return(): Promise<IteratorResult<Chunk>> {
                            release?.();
                            return { value: undefined, done: true };
                        },
                    };
                },
            }),
        } as unknown as ConnectionController;

        const view = new Query(connection, {
            query: new BoundQuery("SLEEP 30s"),
            transaction: undefined,
            session: undefined,
            json: false,
        }).rows();

        const read = view.next();

        await Bun.sleep(10);

        const left = view.return();
        const outcome = await Promise.race([
            Promise.all([read, left]).then(() => "let go"),
            Bun.sleep(2_000).then(() => "still waiting"),
        ]);

        expect(outcome).toBe("let go");
    });

    test("a source which throws is passed on, and let go of", async () => {
        const connection = {
            retry: DEFAULT_RETRY_OPTIONS,
            ready: async () => {},
            query: () => ({
                [Symbol.asyncIterator]() {
                    return {
                        async next(): Promise<IteratorResult<Chunk>> {
                            throw new Error("the connection went away");
                        },
                        async return(): Promise<IteratorResult<Chunk>> {
                            return { value: undefined, done: true };
                        },
                    };
                },
            }),
        } as unknown as ConnectionController;

        const query = new Query(connection, {
            query: new BoundQuery("SELECT 1"),
            transaction: undefined,
            session: undefined,
            json: false,
        });

        await expect(all(query.rows())).rejects.toThrow("the connection went away");
    });
});

describe("what a view holds", () => {
    /** A view over a script of chunks, which counts how often what its request holds is let go. */
    function tracked(chunks: Chunk[]) {
        const state = { disposed: 0, returned: 0 };

        const view = new RowStream<unknown>(
            async () => ({
                chunks: {
                    [Symbol.asyncIterator]() {
                        let next = 0;

                        return {
                            async next(): Promise<IteratorResult<Chunk>> {
                                const chunk = chunks[next++];

                                return chunk
                                    ? { value: chunk, done: false }
                                    : { value: undefined, done: true };
                            },
                            async return(): Promise<IteratorResult<Chunk>> {
                                state.returned++;
                                return { value: undefined, done: true };
                            },
                        };
                    },
                },
                dispose: () => {
                    state.disposed++;
                },
            }),
            false,
        );

        return { view, state };
    }

    test("is let go of once the query has been read to its end", async () => {
        const { view, state } = tracked([last(0, 1)]);

        await all(view);
        await view.return();

        expect(state).toEqual({ disposed: 1, returned: 1 });
    });

    test("is let go of when the view is left part way", async () => {
        const { view, state } = tracked([rows(0, 1, 2), last(0)]);

        await view.next();
        await view.return();
        await view.return();

        expect(state).toEqual({ disposed: 1, returned: 1 });
    });

    test("is let go of when the query fails", async () => {
        const { view, state } = tracked([failed(0, "nope")]);

        await expect(all(view)).rejects.toThrow("nope");

        expect(state).toEqual({ disposed: 1, returned: 1 });
    });

    test("is let go of when the view is left while it is still opening", async () => {
        const state = { disposed: 0, returned: 0 };
        let opened!: () => void;
        const gate = new Promise<void>((resolve) => {
            opened = resolve;
        });

        const view = new RowStream<unknown>(async () => {
            await gate;

            return {
                chunks: {
                    [Symbol.asyncIterator]: () => ({
                        async next(): Promise<IteratorResult<Chunk>> {
                            return { value: last(0, 1), done: false };
                        },
                        async return(): Promise<IteratorResult<Chunk>> {
                            state.returned++;
                            return { value: undefined, done: true };
                        },
                    }),
                },
                dispose: () => {
                    state.disposed++;
                },
            };
        }, false);

        const read = view.next();

        await view.return();
        opened();

        expect(await read).toEqual({ value: undefined, done: true });
        expect(state).toEqual({ disposed: 1, returned: 1 });
    });
});

describe("statements()", () => {
    test("yields each statement whole, once it is final", async () => {
        const { query } = scripted([rows(0, 1, 2), rows(0, 3), last(0), single(1, "one"), last(2)]);

        const statements = await all(query.statements());

        expect(statements.map((statement) => statement.index)).toEqual([0, 1, 2]);
        expect(statements.map((statement) => statement.value)).toEqual([[1, 2, 3], "one", []]);
        expect(statements.map((statement) => statement.single)).toEqual([false, true, false]);
        expect(statements.map((statement) => statement.type)).toEqual(["other", "other", "other"]);
    });

    test("holds a statement back until it has finished", async () => {
        const { query } = scripted([rows(0, 1), rows(1, "x"), last(1), last(0)]);

        // Statement 1 finishes first, so it is first, though statement 0 began before it.
        const statements = await all(query.statements());

        expect(statements.map((statement) => statement.index)).toEqual([1, 0]);
        expect(statements.map((statement) => statement.value)).toEqual([["x"], [1]]);
    });

    test("a statement which is NONE is a statement, with its index, and no value", async () => {
        const { query } = scripted([single(0, undefined), single(1, 2)]);

        const statements = await all(query.statements());

        expect(statements.map((statement) => [statement.index, statement.value])).toEqual([
            [0, undefined],
            [1, 2],
        ]);
    });

    test("a failed statement throws, after the statements which were final", async () => {
        const { query, state } = scripted([last(0, 1), rows(1, 2), failed(1, "nope"), last(2, 3)]);
        const seen: number[] = [];
        let thrown: unknown;

        try {
            for await (const statement of query.statements()) seen.push(statement.index);
        } catch (error) {
            thrown = error;
        }

        // Never retracted: statement 0 was final, and statement 1's rows were never delivered.
        expect(seen).toEqual([0]);
        expect((thrown as Error).message).toBe("nope");
        expect(state.returned).toBe(1);
    });

    test("a statement too large to spread into one call is held whole", async () => {
        // The buffered protocol delivers a statement as one chunk, and one can be larger than
        // the arguments a call can be given.
        // Past what this runtime can spread into a call, which is somewhere above half a million.
        const big = Array.from({ length: 1_200_000 }, (_, index) => index);
        const chunk: Chunk = { query: 0, batch: 0, kind: "batched-final", result: big };
        const { query } = scripted([chunk]);

        const [statement] = await all(query.statements());

        expect((statement?.value as number[]).length).toBe(1_200_000);
    });

    test("asks for a stream, and is left the same way as rows()", async () => {
        const { query, state } = scripted([rows(0, 1), last(0)]);

        for await (const _ of query.statements()) break;
        await all(query.statements());

        expect(state.asked.every((request) => request.stream === true)).toBe(true);
    });
});
