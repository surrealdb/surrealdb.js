import { afterEach, describe, expect, test } from "bun:test";
import {
    BoundQuery,
    CallTerminatedError,
    type QueryChunk,
    RecordId,
    UnexpectedServerResponseError,
    Uuid,
    WebSocketEngine,
} from "surrealdb";
import { type MockRequest, MockSocket, mockContext, mockState } from "../__helpers__/mock-socket";

let engine: WebSocketEngine | undefined;

afterEach(async () => {
    await engine?.close();
    engine = undefined;
    MockSocket.reset();
});

/** What a server answers a request for `method` with when it does not serve it. */
function absent(): { code: number; message: string; kind: string } {
    return { code: -32601, message: "Method not found", kind: "NotFound" };
}

/**
 * What a server answers with when it turns a request away as not allowed, naming what was refused.
 * Denying `query_stream` is the server declining to stream; denying `query` is how it turns away
 * one identity, and refuses the buffered method too.
 */
function denied(name: string): object {
    return {
        code: -32602,
        message: "Method not allowed",
        kind: "NotAllowed",
        details: { kind: "Method", details: { name } },
    };
}

/** Opens an engine against the mocked socket and waits until it is connected. */
async function openEngine(
    options: {
        streaming?: boolean;
        reconnect?: boolean | { retryDelay?: number; retryDelayMax?: number };
    } = {},
): Promise<WebSocketEngine> {
    const opened = new WebSocketEngine(mockContext({ streaming: options.streaming }));

    engine = opened;

    const connected = nextConnection(opened);

    opened.open(mockState(options.reconnect ?? false));

    await connected;

    return opened;
}

/** Resolves the next time the engine reports itself connected. */
function nextConnection(target: WebSocketEngine): Promise<void> {
    return new Promise<void>((resolve) => {
        const unsubscribe = target.subscribe("connected", () => {
            unsubscribe();
            resolve();
        });
    });
}

/** Answers a `query_stream` request with a script of frames, one response each. */
function respondWithFrames(socket: MockSocket, request: MockRequest, frames: object[]): void {
    for (const frame of frames) {
        queueMicrotask(() => socket.respond({ id: request.id, result: frame }));
    }
}

/** The buffered answer to a `query` request, for a single statement. */
function bufferedResponse(request: MockRequest, result: unknown): object {
    return {
        id: request.id,
        result: [{ status: "OK", time: "1ms", result, type: "other" }],
    };
}

const ROWS_THEN_VALUE = [
    { stream: "begin", statements: 2 },
    { stream: "rows", index: 0, values: [{ n: 1 }, { n: 2 }] },
    { stream: "finished", index: 0, time: "1ms", type: "other", single: false },
    { stream: "value", index: 1, value: 42 },
    { stream: "finished", index: 1, time: "1ms", type: "other", single: true },
    { stream: "end", results: 2, time: "2ms" },
];

async function collect<T>(chunks: AsyncIterable<QueryChunk<T>>): Promise<QueryChunk<T>[]> {
    const collected: QueryChunk<T>[] = [];

    for await (const chunk of chunks) {
        collected.push(chunk);
    }

    return collected;
}

describe("websocket query streaming", () => {
    test("a query is sent as a streaming request and answered by its frames", async () => {
        const started = await openEngine();
        const session = Uuid.v4();

        MockSocket.handler = (socket, request) => {
            if (request.method === "query_stream") {
                respondWithFrames(socket, request, ROWS_THEN_VALUE);
            }
        };

        const chunks = await collect(
            started.query(
                new BoundQuery("SELECT * FROM person WHERE age > $age", { age: 18 }),
                session,
            ),
        );

        const [stream] = MockSocket.current.requestsFor("query_stream");

        expect(stream?.params).toEqual(["SELECT * FROM person WHERE age > $age", { age: 18 }]);
        expect(stream?.session?.toString()).toBe(session.toString());
        expect(MockSocket.current.requestsFor("query")).toBeEmpty();
        expect(chunks.map((chunk) => chunk.kind)).toEqual(["batched", "batched-final", "single"]);
        expect(chunks[0]?.result).toEqual([{ n: 1 }, { n: 2 }]);
        expect(chunks[2]?.result).toEqual([42]);
    });

    test("abandoning a stream cancels it and discards the frames still in flight", async () => {
        const started = await openEngine();

        MockSocket.handler = (socket, request) => {
            if (request.method === "query_stream") {
                respondWithFrames(socket, request, [
                    { stream: "begin", statements: 1 },
                    { stream: "rows", index: 0, values: [{ n: 1 }] },
                ]);
            }

            if (request.method === "query_cancel") {
                queueMicrotask(() => socket.respond({ id: request.id, result: null }));
            }
        };

        for await (const chunk of started.query(
            new BoundQuery("SELECT * FROM person"),
            undefined,
        )) {
            expect(chunk.kind).toBe("batched");
            break;
        }

        const [stream] = MockSocket.current.requestsFor("query_stream");
        const [cancel] = MockSocket.current.requestsFor("query_cancel");

        expect(cancel?.params).toEqual([stream?.id]);

        // The frames the server had already sent arrive after the consumer left, and are discarded
        // without disturbing the connection.
        let failure: Error | undefined;

        started.subscribe("error", (error) => {
            failure = error;
        });

        MockSocket.current.respond({
            id: stream?.id,
            result: {
                stream: "end",
                results: 0,
                time: "1ms",
                error: { code: -32005, message: "stopped", kind: "Query" },
            },
        });

        await Bun.sleep(1);

        expect(failure).toBeUndefined();
    });

    test.each([
        ["absent", absent()],
        ["denied", denied("query_stream")],
    ])(
        "a server which says the streaming method is %s is used as before",
        async (_what, refusal) => {
            const started = await openEngine();

            MockSocket.handler = (socket, request) => {
                if (request.method === "query_stream") {
                    queueMicrotask(() =>
                        socket.respond({
                            id: request.id,
                            error: refusal,
                        }),
                    );
                }

                if (request.method === "query") {
                    queueMicrotask(() => socket.respond(bufferedResponse(request, [{ n: 1 }])));
                }
            };

            const first = await collect(
                started.query(new BoundQuery("SELECT * FROM person"), undefined),
            );

            expect(first).toHaveLength(1);
            expect(first[0]).toMatchObject({ kind: "batched-final", result: [{ n: 1 }] });

            // The absence is remembered, so the next query does not ask again.
            const second = await collect(
                started.query(new BoundQuery("SELECT * FROM person"), undefined),
            );

            expect(second).toHaveLength(1);
            expect(MockSocket.current.requestsFor("query_stream")).toHaveLength(1);
            expect(MockSocket.current.requestsFor("query")).toHaveLength(2);
        },
    );

    test("a stream refused for want of capacity falls back only for that query", async () => {
        const started = await openEngine();

        let refused = false;

        MockSocket.handler = (socket, request) => {
            if (request.method === "query_stream") {
                if (!refused) {
                    refused = true;

                    queueMicrotask(() =>
                        socket.respond({
                            id: request.id,
                            error: {
                                code: -32603,
                                message: "Too many concurrent streaming queries",
                                kind: "Validation",
                            },
                        }),
                    );

                    return;
                }

                respondWithFrames(socket, request, ROWS_THEN_VALUE);
            }

            if (request.method === "query") {
                queueMicrotask(() => socket.respond(bufferedResponse(request, [{ n: 1 }])));
            }
        };

        const first = await collect(started.query(new BoundQuery("SELECT 1"), undefined));
        const second = await collect(started.query(new BoundQuery("SELECT 2"), undefined));

        expect(first[0]).toMatchObject({ kind: "batched-final", result: [{ n: 1 }] });
        expect(second).toHaveLength(3);
        expect(MockSocket.current.requestsFor("query_stream")).toHaveLength(2);
        expect(MockSocket.current.requestsFor("query")).toHaveLength(1);
    });

    test("a stream which failed after framing is never replayed as a buffered query", async () => {
        const started = await openEngine();

        MockSocket.handler = (socket, request) => {
            if (request.method === "query_stream") {
                respondWithFrames(socket, request, [
                    { stream: "begin", statements: 1 },
                    {
                        stream: "end",
                        results: 0,
                        time: "1ms",
                        error: { code: -32004, message: "The query timed out", kind: "Query" },
                    },
                ]);
            }
        };

        const attempt = collect(started.query(new BoundQuery("SELECT * FROM person"), undefined));

        await expect(attempt).rejects.toThrow("timed out");

        await Bun.sleep(1);

        expect(MockSocket.current.requestsFor("query")).toBeEmpty();
    });

    test("a stream is failed rather than replayed when its socket goes away", async () => {
        const started = await openEngine();

        MockSocket.handler = (socket, request) => {
            if (request.method === "query_stream") {
                respondWithFrames(socket, request, [{ stream: "begin", statements: 1 }]);
            }
        };

        const chunks = started.query(new BoundQuery("SELECT * FROM person"), undefined);
        const iterator = chunks[Symbol.asyncIterator]();
        const first = iterator.next();

        await Bun.sleep(1);

        MockSocket.current.close();

        await expect(first).rejects.toBeInstanceOf(CallTerminatedError);
    });

    test("a query inside a transaction is never streamed", async () => {
        const started = await openEngine();

        MockSocket.handler = (socket, request) => {
            if (request.method === "query") {
                queueMicrotask(() => socket.respond(bufferedResponse(request, [{ n: 1 }])));
            }
        };

        const chunks = await collect(
            started.query(new BoundQuery("SELECT * FROM person"), undefined, Uuid.v4()),
        );

        expect(chunks).toHaveLength(1);
        expect(MockSocket.current.requestsFor("query_stream")).toBeEmpty();
        expect(MockSocket.current.requestsFor("query")).toHaveLength(1);
    });

    test("streaming can be turned off for the driver", async () => {
        const started = await openEngine({ streaming: false });

        MockSocket.handler = (socket, request) => {
            if (request.method === "query") {
                queueMicrotask(() => socket.respond(bufferedResponse(request, [{ n: 1 }])));
            }
        };

        await collect(started.query(new BoundQuery("SELECT * FROM person"), undefined));

        expect(MockSocket.current.requestsFor("query_stream")).toBeEmpty();
        expect(MockSocket.current.requestsFor("query")).toHaveLength(1);
    });

    describe("a stream which was asked for", () => {
        const WANT = { stream: true };

        /** Answers streams in full and buffered queries with a single row. */
        function serve(refuse?: { code: number; message: string }) {
            MockSocket.handler = (socket, request) => {
                if (request.method === "query_stream") {
                    if (refuse) {
                        queueMicrotask(() => socket.respond({ id: request.id, error: refuse }));
                        return;
                    }

                    respondWithFrames(socket, request, ROWS_THEN_VALUE);
                }

                if (request.method === "query") {
                    queueMicrotask(() => socket.respond(bufferedResponse(request, [{ n: 1 }])));
                }
            };
        }

        test("streams inside a transaction, which a query merely awaited does not", async () => {
            const started = await openEngine();
            const txn = Uuid.v4();

            serve();

            const asked = await collect(
                started.query(new BoundQuery("SELECT * FROM person"), undefined, txn, WANT),
            );
            const accepted = await collect(
                started.query(new BoundQuery("SELECT * FROM person"), undefined, txn),
            );

            expect(asked.map((chunk) => chunk.kind)).toEqual([
                "batched",
                "batched-final",
                "single",
            ]);
            expect(accepted).toHaveLength(1);

            const [stream] = MockSocket.current.requestsFor("query_stream");

            // The stream is run on the transaction it was asked for on.
            expect(String(stream?.txn)).toBe(txn.toString());
            expect(MockSocket.current.requestsFor("query_stream")).toHaveLength(1);
            expect(MockSocket.current.requestsFor("query")).toHaveLength(1);
        });

        test("carries no transaction when it is not in one", async () => {
            const started = await openEngine();

            serve();

            await collect(started.query(new BoundQuery("RETURN 1"), undefined, undefined, WANT));

            const [stream] = MockSocket.current.requestsFor("query_stream");

            expect(stream).toBeDefined();
            expect("txn" in (stream ?? {})).toBe(false);
        });

        test("streams in spite of the driver being configured not to", async () => {
            const started = await openEngine({ streaming: false });

            serve();

            const asked = await collect(
                started.query(new BoundQuery("RETURN 1"), undefined, undefined, WANT),
            );
            const accepted = await collect(
                started.query(new BoundQuery("RETURN 1"), undefined, undefined),
            );

            expect(asked).toHaveLength(3);
            expect(accepted).toHaveLength(1);
            expect(MockSocket.current.requestsFor("query_stream")).toHaveLength(1);
            expect(MockSocket.current.requestsFor("query")).toHaveLength(1);
        });

        test("is refused, not quietly buffered, when the connection is at its limit", async () => {
            const started = await openEngine();

            serve({ code: -32603, message: "Too many concurrent streaming queries" });

            const outcome = collect(
                started.query(new BoundQuery("SELECT * FROM person"), undefined, undefined, WANT),
            ).then(
                () => "resolved",
                (error: Error) => `${error.constructor.name}: ${error.message}`,
            );

            expect(await outcome).toMatch(/Too many concurrent streaming queries/);

            // Asked of the server once, and never turned into a buffered query behind its back.
            expect(MockSocket.current.requestsFor("query_stream")).toHaveLength(1);
            expect(MockSocket.current.requestsFor("query")).toBeEmpty();

            // The refusal is about that stream, so it is not remembered as the server's inability.
            serve();

            expect(
                await collect(
                    started.query(new BoundQuery("RETURN 1"), undefined, undefined, WANT),
                ),
            ).toHaveLength(3);
        });

        test.each([
            ["absent", absent()],
            ["denied", denied("query_stream")],
        ])(
            "is answered, buffered, by a server which cannot stream (%s)",
            async (_what, refusal) => {
                const started = await openEngine();

                serve(refusal as { code: number; message: string });

                const first = await collect(
                    started.query(
                        new BoundQuery("SELECT * FROM person"),
                        undefined,
                        undefined,
                        WANT,
                    ),
                );

                // The stream is a way of receiving the answer, and the answer is still wanted.
                expect(first).toHaveLength(1);
                expect(first[0]).toMatchObject({ kind: "batched-final", result: [{ n: 1 }] });

                // And what the server cannot do is learned, so it is not asked again.
                await collect(
                    started.query(new BoundQuery("RETURN 1"), undefined, undefined, WANT),
                );

                expect(MockSocket.current.requestsFor("query_stream")).toHaveLength(1);
                expect(MockSocket.current.requestsFor("query")).toHaveLength(2);
            },
        );

        test("a caller turned away is not the server being unable to stream", async () => {
            const started = await openEngine();

            // `query` is refused for this identity, and so is the buffered method.
            serve(denied("query") as { code: number; message: string });

            const outcome = collect(
                started.query(new BoundQuery("RETURN 1"), undefined, undefined, WANT),
            ).then(
                () => "resolved",
                (error: Error) => error.constructor.name,
            );

            // Told so, rather than quietly served the same refusal from the buffered method.
            expect(await outcome).toBe("NotAllowedError");
            expect(MockSocket.current.requestsFor("query")).toBeEmpty();

            // The caller signs in as someone else on the same socket, who is allowed.
            serve();

            const next = await collect(
                started.query(new BoundQuery("RETURN 1"), undefined, undefined, WANT),
            );

            // It was asked of the server again, and streamed: nothing was learned about the server.
            expect(next).toHaveLength(3);
            expect(MockSocket.current.requestsFor("query_stream")).toHaveLength(2);
            expect(MockSocket.current.requestsFor("query")).toBeEmpty();
        });

        test("nor is it learned for a query which was simply awaited", async () => {
            const started = await openEngine();

            serve(denied("query") as { code: number; message: string });

            // Buffered afterwards, which is refused in its own right.
            await collect(started.query(new BoundQuery("RETURN 1"), undefined));

            serve();

            const next = await collect(started.query(new BoundQuery("RETURN 1"), undefined));

            expect(next).toHaveLength(3);
            expect(MockSocket.current.requestsFor("query_stream")).toHaveLength(2);
        });

        test("a denial which does not say what was denied is not learned either", async () => {
            const started = await openEngine();

            serve({ code: -32602, message: "Method not allowed" });

            await collect(started.query(new BoundQuery("RETURN 1"), undefined));
            await collect(started.query(new BoundQuery("RETURN 2"), undefined));

            // Asked every time, which costs a refused request each, and is never wrong.
            expect(MockSocket.current.requestsFor("query_stream")).toHaveLength(2);
        });

        test("an ordinary query is still buffered at the limit, for that query alone", async () => {
            const started = await openEngine();

            serve({ code: -32603, message: "Too many concurrent streaming queries" });

            const chunks = await collect(
                started.query(new BoundQuery("SELECT * FROM person"), undefined),
            );

            expect(chunks).toHaveLength(1);
            expect(MockSocket.current.requestsFor("query")).toHaveLength(1);
        });
    });

    describe("a server known to predate streaming", () => {
        async function connectedTo(version: string | undefined): Promise<WebSocketEngine> {
            const started = await openEngine();

            started.ready(version);

            MockSocket.handler = (socket, request) => {
                if (request.method === "query_stream") {
                    respondWithFrames(socket, request, ROWS_THEN_VALUE);
                }

                if (request.method === "query") {
                    queueMicrotask(() => socket.respond(bufferedResponse(request, [{ n: 1 }])));
                }
            };

            return started;
        }

        test.each([
            "surrealdb-2.1.0",
            "surrealdb-3.0.5",
            "surrealdb-3.2.3",
            "3.2.3+20260721.40522d1",
            "3.2.99",
        ])("is not asked at all (%p)", async (version) => {
            const started = await connectedTo(version);

            // Asked for or not, it is not asked: it is known not to be able to.
            await collect(started.query(new BoundQuery("RETURN 1"), undefined));
            await collect(
                started.query(new BoundQuery("RETURN 1"), undefined, undefined, { stream: true }),
            );

            expect(MockSocket.current.requestsFor("query_stream")).toBeEmpty();
            expect(MockSocket.current.requestsFor("query")).toHaveLength(2);
        });

        test.each([
            "surrealdb-3.3.0",
            "3.3.0",
            "3.4.0-nightly+20261005.8bd73c4",
            // A prerelease of the release which introduced it may or may not have it.
            "3.3.0-beta.3",
            // Newer than anything this SDK was written against says nothing against streaming.
            "surrealdb-6.0.0",
            "surrealdb-12.1.0",
        ])("is asked, as asking is what decides (%p)", async (version) => {
            const started = await connectedTo(version);

            const chunks = await collect(started.query(new BoundQuery("RETURN 1"), undefined));

            expect(chunks).toHaveLength(3);
            expect(MockSocket.current.requestsFor("query_stream")).toHaveLength(1);
        });

        test.each([undefined, "", "nightly", "not a version"])(
            "is asked when the version is not known or not understood (%p)",
            async (version) => {
                const started = await connectedTo(version);

                await collect(started.query(new BoundQuery("RETURN 1"), undefined));

                expect(MockSocket.current.requestsFor("query_stream")).toHaveLength(1);
            },
        );
    });

    test("a long burst of frames arrives complete and in order", async () => {
        const started = await openEngine();

        // Frames as the server ramps its batches: 16, 32, 64, 128, then 256 at a time.
        const batches: number[] = [16, 32, 64, 128];
        while (batches.reduce((total, size) => total + size, 0) < 2000) batches.push(256);

        MockSocket.handler = (socket, request) => {
            if (request.method !== "query_stream") return;

            let next = 0;
            const frames: object[] = [{ stream: "begin", statements: 1 }];

            for (const size of batches) {
                frames.push({
                    stream: "rows",
                    index: 0,
                    values: Array.from({ length: size }, () => next++),
                });
            }

            frames.push({
                stream: "finished",
                index: 0,
                time: "1ms",
                type: "other",
                single: false,
            });
            frames.push({ stream: "end", results: 1, time: "1ms" });

            respondWithFrames(socket, request, frames);
        };

        const rows: number[] = [];

        for await (const chunk of started.query<number>(
            new BoundQuery("SELECT * FROM wide"),
            undefined,
        )) {
            rows.push(...(chunk.result ?? []));
        }

        const expected = batches.reduce((total, size) => total + size, 0);

        expect(rows).toHaveLength(expected);
        expect(rows).toEqual(Array.from({ length: expected }, (_, index) => index));
    });

    test("two streams on one connection keep their own frames", async () => {
        const started = await openEngine();

        MockSocket.handler = (socket, request) => {
            if (request.method !== "query_stream") return;

            const marker = request.params?.[0] === "SELECT 1" ? "one" : "two";

            respondWithFrames(socket, request, [
                { stream: "begin", statements: 1 },
                { stream: "rows", index: 0, values: [`${marker}-a`] },
                { stream: "rows", index: 0, values: [`${marker}-b`] },
                { stream: "finished", index: 0, time: "1ms", type: "other", single: false },
                { stream: "end", results: 1, time: "1ms" },
            ]);
        };

        const [first, second] = await Promise.all([
            collect(started.query<string>(new BoundQuery("SELECT 1"), undefined)),
            collect(started.query<string>(new BoundQuery("SELECT 2"), undefined)),
        ]);

        expect(first.flatMap((chunk) => chunk.result ?? [])).toEqual(["one-a", "one-b"]);
        expect(second.flatMap((chunk) => chunk.result ?? [])).toEqual(["two-a", "two-b"]);
    });

    test("a stream abandoned between frames lets go of its consumer at once", async () => {
        const started = await openEngine();

        // One frame and then silence: a real stream can sit for a long time between frames, or
        // produce none at all, and leaving it must not wait for the next one.
        MockSocket.handler = (socket, request) => {
            if (request.method === "query_stream") {
                respondWithFrames(socket, request, [
                    { stream: "begin", statements: 1 },
                    { stream: "rows", index: 0, values: [{ n: 1 }] },
                ]);
            }
        };

        for await (const chunk of started.query(
            new BoundQuery("SELECT * FROM person"),
            undefined,
        )) {
            expect(chunk.kind).toBe("batched");
            break;
        }

        // Reaching here at all is the assertion: the loop would otherwise be parked on a frame
        // the server is never going to send.
        const [stream] = MockSocket.current.requestsFor("query_stream");
        const [cancel] = MockSocket.current.requestsFor("query_cancel");

        expect(cancel?.params).toEqual([stream?.id]);
    });

    test("abandoning a read parked on a frame lets go of the consumer at once", async () => {
        const started = await openEngine();

        MockSocket.handler = (socket, request) => {
            if (request.method === "query_stream") {
                respondWithFrames(socket, request, [
                    { stream: "begin", statements: 1 },
                    { stream: "rows", index: 0, values: [{ n: 1 }] },
                ]);
            }
        };

        const iterator = started
            .query(new BoundQuery("SELECT * FROM person"), undefined)
            [Symbol.asyncIterator]();

        await iterator.next();

        // A consumer which races a read against a timeout leaves while that read is still
        // parked on a frame the server is not going to send.
        const parked = iterator.next();
        const returned = iterator.return?.();

        const outcome = await Promise.race([
            Promise.all([parked, returned]).then(() => "let go"),
            Bun.sleep(2_000).then(() => "still waiting"),
        ]);

        expect(outcome).toBe("let go");
        expect(MockSocket.current.requestsFor("query_cancel")).toHaveLength(1);
    });

    test("a stream which ran to its end is not cancelled", async () => {
        const started = await openEngine();

        MockSocket.handler = (socket, request) => {
            if (request.method === "query_stream") {
                respondWithFrames(socket, request, ROWS_THEN_VALUE);
            }
        };

        await collect(started.query(new BoundQuery("SELECT * FROM person"), undefined));
        await Bun.sleep(1);

        expect(MockSocket.current.requestsFor("query_cancel")).toBeEmpty();
    });

    test("every streaming request carries its own id", async () => {
        const started = await openEngine();

        MockSocket.handler = (socket, request) => {
            if (request.method === "query_stream") {
                respondWithFrames(socket, request, ROWS_THEN_VALUE);
            }
        };

        await Promise.all([
            collect(started.query(new BoundQuery("SELECT 1"), undefined)),
            collect(started.query(new BoundQuery("SELECT 2"), undefined)),
        ]);

        const ids = MockSocket.current.requestsFor("query_stream").map((request) => request.id);

        expect(ids).toHaveLength(2);
        expect(new Set(ids).size).toBe(2);

        for (const id of ids) {
            expect(id).toBeString();
            expect(id).not.toBeEmpty();
        }
    });

    test("a response which is not a frame fails the stream", async () => {
        const started = await openEngine();

        MockSocket.handler = (socket, request) => {
            if (request.method === "query_stream") {
                // A payload of the shape any other method would answer with.
                queueMicrotask(() => socket.respond({ id: request.id, result: [{ n: 1 }] }));
            }
        };

        const attempt = collect(started.query(new BoundQuery("SELECT * FROM person"), undefined));

        await expect(attempt).rejects.toBeInstanceOf(UnexpectedServerResponseError);
    });

    test("a query which lost its socket before any frame is failed, never sent again", async () => {
        const started = await openEngine({ reconnect: true });
        const first = MockSocket.current;

        // The connection controller re-sends what is still pending once a new socket is up.
        const controller = started.subscribe("connected", () => started.ready());

        MockSocket.handler = (socket, request) => {
            if (request.method !== "query_stream") return;

            // The socket dies with the request written and nothing framed. The server enqueues
            // `begin` ahead of executing, so a frame which never arrived does not show that the
            // query never started - and sending it again would run it twice.
            if (socket === first) {
                queueMicrotask(() => socket.close());
                return;
            }

            respondWithFrames(socket, request, ROWS_THEN_VALUE);
        };

        const reconnected = nextConnection(started);
        const outcome = collect(started.query(new BoundQuery("CREATE person"), undefined)).then(
            () => "resolved",
            (error: Error) => error.constructor.name,
        );

        expect(await Promise.race([outcome, Bun.sleep(2_000).then(() => "still waiting")])).toBe(
            "CallTerminatedError",
        );

        await reconnected;
        controller();

        // Once the connection is back nothing is sent for it: not as a stream, and not turned
        // into a buffered query either.
        const requests = MockSocket.sockets.flatMap((socket) => socket.requests);

        expect(requests.filter((request) => request.method === "query_stream")).toHaveLength(1);
        expect(requests.filter((request) => request.method === "query")).toBeEmpty();
    });

    test("closing fails a query in flight, streamed or buffered alike", async () => {
        for (const streaming of [true, false]) {
            MockSocket.reset();

            const started = await openEngine({ streaming });

            MockSocket.handler = () => {
                // Answer nothing: the query is in flight when the connection is closed.
            };

            const attempt = collect(started.query(new BoundQuery("SLEEP 5s"), undefined));
            const outcome = attempt.then(
                () => "resolved",
                (error: Error) => error.constructor.name,
            );

            await Bun.sleep(10);
            await started.close();

            // Raced, so a promise which never settles fails this rather than hanging the run.
            expect(
                await Promise.race([outcome, Bun.sleep(1_000).then(() => "still waiting")]),
            ).toBe("CallTerminatedError");

            engine = undefined;
        }
    });

    test("a query issued after closing is refused rather than queued", async () => {
        const started = await openEngine();

        MockSocket.handler = () => {};

        await started.close();

        const attempt = collect(started.query(new BoundQuery("RETURN 1"), undefined));
        const outcome = attempt.then(
            () => "resolved",
            (error: Error) => error.constructor.name,
        );

        expect(await Promise.race([outcome, Bun.sleep(1_000).then(() => "still waiting")])).toBe(
            "ConnectionUnavailableError",
        );

        engine = undefined;
    });

    test("a query which lost its socket part way through is failed, never replayed", async () => {
        const started = await openEngine({ reconnect: true });

        MockSocket.handler = (socket, request) => {
            if (request.method === "query_stream") {
                respondWithFrames(socket, request, [
                    { stream: "begin", statements: 1 },
                    { stream: "rows", index: 0, values: [{ n: 1 }] },
                ]);
                queueMicrotask(() => socket.close());
            }
        };

        const attempt = collect(started.query(new BoundQuery("SELECT * FROM person"), undefined));

        await expect(attempt).rejects.toBeInstanceOf(CallTerminatedError);

        const requests = MockSocket.sockets.flatMap((socket) => socket.requests);

        expect(requests.filter((request) => request.method === "query")).toBeEmpty();
    });

    test("a second query and live notifications flow while a stream is open", async () => {
        const started = await openEngine();

        const live = Uuid.v4();
        let held: MockRequest | undefined;

        MockSocket.handler = (socket, request) => {
            if (request.method !== "query_stream") return;

            // The long running query is left open; anything else is answered in full.
            if (request.params?.[0] === "SLEEP 5s") {
                held = request;
                respondWithFrames(socket, request, [{ stream: "begin", statements: 1 }]);
                return;
            }

            respondWithFrames(socket, request, [
                { stream: "begin", statements: 1 },
                { stream: "value", index: 0, value: 7 },
                { stream: "finished", index: 0, time: "1ms", type: "other", single: true },
                { stream: "end", results: 1, time: "1ms" },
            ]);
        };

        const iterator = started
            .query(new BoundQuery("SLEEP 5s"), undefined)
            [Symbol.asyncIterator]();
        const pending = iterator.next();

        await Bun.sleep(1);

        // A second query answers while the first stream occupies the connection.
        const notifications = started.liveQuery(live)[Symbol.asyncIterator]();
        const notification = notifications.next();
        const second = await collect(started.query(new BoundQuery("RETURN 7"), undefined));

        expect(second.at(-1)?.result).toEqual([7]);

        // A live notification carries no request id, and is dispatched as usual.
        MockSocket.current.respond({
            result: {
                id: live,
                action: "CREATE",
                record: new RecordId("thing", 1),
                result: { n: 1 },
            },
        });

        expect((await notification).value).toMatchObject({ action: "CREATE" });

        // And the held stream still completes on its own terms.
        MockSocket.current.respond({
            id: held?.id,
            result: { stream: "value", index: 0, value: "slept" },
        });
        MockSocket.current.respond({
            id: held?.id,
            result: { stream: "finished", index: 0, time: "5s", type: "other", single: true },
        });
        MockSocket.current.respond({
            id: held?.id,
            result: { stream: "end", results: 1, time: "5s" },
        });

        expect((await pending).value).toMatchObject({ kind: "single", result: ["slept"] });
        expect((await iterator.next()).done).toBe(true);
    });
});
