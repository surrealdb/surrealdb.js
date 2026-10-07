import { afterEach, describe, expect, test } from "bun:test";
import {
    applyDiagnostics,
    type QueryChunk,
    QueryError,
    RecordId,
    Surreal,
    SurrealError,
    SurrealRequestScope,
    Table,
    Uuid,
} from "surrealdb";
import {
    connectFake,
    type FakeEngine,
    hang,
    type SentRequest,
    stall,
} from "../__helpers__/mock-engine";

const person = new Table("person");

let open: Surreal | undefined;

afterEach(async () => {
    await open?.close();
    open = undefined;
});

async function connect(...args: Parameters<typeof connectFake>) {
    const connected = await connectFake(...args);
    open = connected.db;
    return connected;
}

async function caught(promise: Promise<unknown>): Promise<unknown> {
    try {
        await promise;
    } catch (error) {
        return error;
    }

    throw new Error("Expected the promise to reject");
}

async function drain(iterable: AsyncIterable<unknown>): Promise<void> {
    for await (const _ of iterable) {
        // Nothing to do with it
    }
}

const ok = (result: unknown = []) => [{ status: "OK", time: "1ms", result, type: "other" }];

const conflict = () =>
    new QueryError({
        message: "Transaction conflict",
        kind: "Query",
        details: { kind: "TransactionConflict" },
    });

/** The signal an engine was handed for a request */
function signalOf(sent: SentRequest | undefined): AbortSignal | undefined {
    return sent?.options?.signal;
}

describe("query signals", () => {
    test("a signal which has aborted already rejects with the reason and sends nothing", async () => {
        const { db, engine } = await connect();
        const reason = new Error("client went away");
        const controller = new AbortController();
        controller.abort(reason);

        const query = () => db.query("SELECT * FROM person").signal(controller.signal);

        expect(await caught(query().collect())).toBe(reason);
        expect(await caught(query().responses())).toBe(reason);
        expect(await caught(drain(query().stream()))).toBe(reason);
        expect(await caught(Promise.resolve(query()))).toBe(reason);
        expect(engine.sent).toEqual([]);
    });

    test("a query which is not aborted is answered as before, and is handed the signal", async () => {
        const { db, engine } = await connect();
        const controller = new AbortController();
        engine.respond = async () => ok([{ id: 1 }]);

        const [rows] = await db
            .query("SELECT * FROM person")
            .signal(controller.signal)
            .collect<[unknown[]]>();

        expect(rows).toEqual([{ id: 1 }]);
        expect(engine.sent).toHaveLength(1);

        // Not the same object, as it may be combined with others, but one which follows it
        const handed = signalOf(engine.sent[0]);
        expect(handed?.aborted).toBe(false);
    });

    test("a query with no signal is handed none", async () => {
        const { db, engine } = await connect();

        await db.query("RETURN 1").collect();
        await db.select(person);

        expect(engine.sent).toHaveLength(2);
        expect(signalOf(engine.sent[0])).toBeUndefined();
        expect(signalOf(engine.sent[1])).toBeUndefined();
    });

    test("the engine is told when the signal aborts", async () => {
        const { db, engine } = await connect();
        const controller = new AbortController();
        const reason = new Error("client went away");
        engine.respond = (_, options) => hang(options);

        const running = db.query("SELECT * FROM slow").signal(controller.signal).collect();

        await Bun.sleep(1);
        const handed = signalOf(engine.sent[0]);
        expect(handed?.aborted).toBe(false);

        controller.abort(reason);

        expect(handed?.aborted).toBe(true);
        expect(handed?.reason).toBe(reason);
        expect(await caught(running)).toBe(reason);
    });

    test.each([
        ["an AbortError", () => new DOMException("The operation was aborted.", "AbortError")],
        ["a TimeoutError", () => new DOMException("The operation timed out.", "TimeoutError")],
        ["a custom reason", () => new Error("custom")],
        ["a value which is not an error", () => "just a string"],
    ])("aborting with %s reaches the caller as it is", async (_, makeReason) => {
        const { db, engine } = await connect();
        engine.respond = (_, options) => hang(options);

        for (const read of [
            (q: ReturnType<typeof db.query>) => q.collect(),
            (q: ReturnType<typeof db.query>) => q.responses(),
            (q: ReturnType<typeof db.query>) => drain(q.stream()),
        ]) {
            const controller = new AbortController();
            const reason = makeReason();
            const running = read(db.query("SELECT * FROM slow").signal(controller.signal));

            await Bun.sleep(1);
            controller.abort(reason);

            const error = await caught(running);

            expect(error).toBe(reason);
            expect(error instanceof SurrealError).toBe(false);
        }
    });

    test("an engine which ignores signals is not waited on", async () => {
        const { db, engine } = await connect();
        const controller = new AbortController();
        const reason = new Error("client went away");
        const started = performance.now();
        engine.respond = stall;

        const reads = [
            db.query("SELECT * FROM slow").signal(controller.signal).collect(),
            db.query("SELECT * FROM slow").signal(controller.signal).responses(),
            drain(db.query("SELECT * FROM slow").signal(controller.signal).stream()),
        ];

        await Bun.sleep(5);
        controller.abort(reason);

        for (const read of reads) {
            expect(await caught(read)).toBe(reason);
        }

        expect(performance.now() - started).toBeLessThan(1000);
    });

    test("several signals are combined, and the first to abort is the reason", async () => {
        const { db, engine } = await connect();
        engine.respond = (_, options) => hang(options);

        const first = new AbortController();
        const second = new AbortController();
        const reason = new Error("second");

        const running = db
            .query("SELECT * FROM slow")
            .signal(first.signal)
            .signal(undefined)
            .signal(second.signal)
            .collect();

        await Bun.sleep(1);
        second.abort(reason);
        first.abort(new Error("first, but too late"));

        expect(await caught(running)).toBe(reason);
    });

    test("one query's signal does not affect another", async () => {
        const { db, engine } = await connect();
        const controller = new AbortController();
        engine.respond = async (_, options) => {
            await Bun.sleep(10);
            if (options?.signal?.aborted) throw options.signal.reason;
            return ok(["done"]);
        };

        const aborted = db.query("SELECT 1").signal(controller.signal).collect();
        const other = db.query("SELECT 2").collect();

        controller.abort(new Error("client went away"));

        await caught(aborted);
        expect(await other).toEqual([["done"]]);
    });

    test("the query is sent once however it is configured", async () => {
        const { db, engine } = await connect();
        const controller = new AbortController();

        await db
            .query("RETURN 1")
            .json()
            .signal(controller.signal)
            .requestTimeout(1000)
            .retry(false)
            .collect();

        expect(engine.sent).toHaveLength(1);
    });

    test("signals are not held on to once the query has finished, however it ended", async () => {
        const { db, engine } = await connect();
        const controller = new AbortController();
        const { signal } = controller;

        let held = 0;
        const add = signal.addEventListener.bind(signal);
        const remove = signal.removeEventListener.bind(signal);

        signal.addEventListener = ((...args: Parameters<typeof add>) => {
            if (typeof args[2] === "object" && args[2]?.once) held++;
            return add(...args);
        }) as typeof add;
        signal.removeEventListener = ((...args: Parameters<typeof remove>) => {
            held--;
            return remove(...args);
        }) as typeof remove;

        for (let i = 0; i < 5; i++) {
            await db.query("RETURN 1").signal(signal).collect();
            await db.query("RETURN 1").signal(signal).responses();
            await drain(db.query("RETURN 1").signal(signal).stream());

            // Failing, and abandoned half way through
            engine.respond = async () => {
                throw new Error("server failed");
            };
            await caught(db.query("RETURN 1").signal(signal).collect());
            engine.respond = async () => ok([1, 2, 3]);
            for await (const _ of db.query("RETURN 1").signal(signal).stream()) break;
        }

        expect(held).toBe(0);
    });
});

describe("streams and signals", () => {
    /** An engine query which yields what it is told to, and records how it was left. */
    function scripted(engine: FakeEngine) {
        const log = { returned: 0, options: undefined as SentRequest["options"] };
        let push: (chunk: QueryChunk<unknown>) => void = () => {};
        let finish: () => void = () => {};
        let fail: (error: unknown) => void = () => {};

        engine.queryImpl = (_query, _session, _txn, options) => {
            log.options = options;

            return {
                [Symbol.asyncIterator]() {
                    const waiting: ((result: IteratorResult<QueryChunk<unknown>>) => void)[] = [];
                    const failing: ((error: unknown) => void)[] = [];
                    const buffered: QueryChunk<unknown>[] = [];

                    push = (chunk) => {
                        const waiter = waiting.shift();
                        failing.shift();
                        if (waiter) waiter({ done: false, value: chunk });
                        else buffered.push(chunk);
                    };
                    finish = () => waiting.shift()?.({ done: true, value: undefined });
                    fail = (error) => failing.shift()?.(error);

                    return {
                        next() {
                            const chunk = buffered.shift();
                            if (chunk) return Promise.resolve({ done: false, value: chunk });

                            return new Promise((resolve, reject) => {
                                waiting.push(resolve);
                                failing.push(reject);
                            });
                        },
                        async return() {
                            log.returned++;
                            return { done: true as const, value: undefined };
                        },
                    };
                },
            };
        };

        return {
            log,
            push: (value: unknown) =>
                push({ query: 0, batch: 0, kind: "batched", result: [value] }),
            finish: () => finish(),
            fail: (error: unknown) => fail(error),
        };
    }

    test("aborting ends the iteration with the reason and releases the stream", async () => {
        const { db, engine } = await connect();
        const source = scripted(engine);
        const controller = new AbortController();
        const reason = new Error("client went away");
        const seen: unknown[] = [];

        const reading = (async () => {
            for await (const frame of db
                .query("SELECT * FROM person")
                .signal(controller.signal)
                .stream()) {
                if (frame.isValue()) seen.push(frame.value);
            }
        })();

        await Bun.sleep(1);
        source.push("first");
        await Bun.sleep(1);
        expect(seen).toEqual(["first"]);

        controller.abort(reason);

        expect(await caught(reading)).toBe(reason);
        expect(source.log.returned).toBe(1);
    });

    test("an abort while the consumer is busy releases the stream at once, and is raised when it next reads", async () => {
        const { db, engine } = await connect();
        const source = scripted(engine);
        const controller = new AbortController();
        const reason = new Error("client went away");
        let resume: () => void = () => {};
        const busy = new Promise<void>((resolve) => {
            resume = resolve;
        });
        const releasedWhileBusy: number[] = [];

        const reading = (async () => {
            for await (const _ of db
                .query("SELECT * FROM person")
                .signal(controller.signal)
                .stream()) {
                // Not reading the stream while this is awaited
                await busy;
            }
        })();

        await Bun.sleep(1);
        source.push("first");
        await Bun.sleep(1);

        controller.abort(reason);
        releasedWhileBusy.push(source.log.returned);
        resume();

        expect(await caught(reading)).toBe(reason);
        expect(releasedWhileBusy).toEqual([1]);
    });

    test("stopping early releases the stream", async () => {
        const { db, engine } = await connect();
        const source = scripted(engine);
        const controller = new AbortController();

        const reading = (async () => {
            for await (const _ of db
                .query("SELECT * FROM person")
                .signal(controller.signal)
                .stream()) {
                break;
            }
        })();

        await Bun.sleep(1);
        source.push("first");
        await reading;

        expect(source.log.returned).toBe(1);

        // And a later abort has nothing left to release
        controller.abort(new Error("late"));
        expect(source.log.returned).toBe(1);
    });

    test("the engine is handed the signal for a stream too", async () => {
        const { db, engine } = await connect();
        const source = scripted(engine);
        const controller = new AbortController();

        const reading = drain(db.query("SELECT 1").signal(controller.signal).stream());

        await Bun.sleep(1);
        const reason = new Error("client went away");
        controller.abort(reason);
        await caught(reading);

        expect(source.log.options?.signal?.aborted).toBe(true);
        expect(source.log.options?.signal?.reason).toBe(reason);
    });

    test("a stream which is not aborted runs to the end as before", async () => {
        const { db, engine } = await connect();
        const source = scripted(engine);
        const controller = new AbortController();
        const seen: unknown[] = [];

        const reading = (async () => {
            for await (const frame of db
                .query("SELECT * FROM person")
                .signal(controller.signal)
                .stream()) {
                if (frame.isValue()) seen.push(frame.value);
            }
        })();

        await Bun.sleep(1);
        source.push(1);
        source.push(2);
        await Bun.sleep(1);
        source.finish();
        await reading;

        expect(seen).toEqual([1, 2]);
    });

    test("a builder streams under a signal as well", async () => {
        const { db, engine } = await connect();
        const source = scripted(engine);
        const controller = new AbortController();
        const reason = new Error("client went away");

        const reading = drain(db.select(person).signal(controller.signal).stream());

        await Bun.sleep(1);
        controller.abort(reason);

        expect(await caught(reading)).toBe(reason);
        expect(source.log.returned).toBe(1);
    });
});

describe("retry and signals", () => {
    const retrying = { retryDelay: 5000, retryDelayMax: 5000, retryDelayJitter: 0 };

    test("a query waiting to retry gives up with the reason when the signal aborts", async () => {
        const { db, engine } = await connect();
        const controller = new AbortController();
        const reason = new Error("client went away");
        const started = performance.now();
        engine.respond = async () => {
            throw conflict();
        };

        const running = db
            .query("UPDATE counter SET n += 1")
            .retry(retrying)
            .signal(controller.signal)
            .collect();

        setTimeout(() => controller.abort(reason), 30);

        expect(await caught(running)).toBe(reason);
        expect(engine.sent).toHaveLength(1);
        expect(performance.now() - started).toBeLessThan(1000);
    });

    test("an aborted query is not retried", async () => {
        const { db, engine } = await connect();
        const controller = new AbortController();
        const reason = new Error("client went away");
        engine.respond = async () => {
            controller.abort(reason);
            throw conflict();
        };

        const running = db
            .query("UPDATE counter SET n += 1")
            .retry({ ...retrying, retryDelay: 0, retryDelayMax: 0 })
            .signal(controller.signal)
            .collect();

        expect(await caught(running)).toBe(reason);
        expect(engine.sent).toHaveLength(1);
    });

    test("a builder retries and aborts the same way", async () => {
        const { db, engine } = await connect();
        const controller = new AbortController();
        const reason = new Error("client went away");
        engine.respond = async () => {
            throw conflict();
        };

        const running = db
            .update(new RecordId("counter", 1))
            .merge({ n: 1 })
            .retry(retrying)
            .signal(controller.signal);

        setTimeout(() => controller.abort(reason), 30);

        expect(await caught(Promise.resolve(running))).toBe(reason);
        expect(engine.sent).toHaveLength(1);
    });

    test("a signal which never aborts leaves retrying as it was", async () => {
        const { db, engine } = await connect();
        const controller = new AbortController();
        let calls = 0;
        engine.respond = async () => {
            if (++calls < 3) throw conflict();
            return ok(["done"]);
        };

        const result = await db
            .query("UPDATE counter SET n += 1")
            .retry({ retryDelay: 0, retryDelayMax: 0 })
            .signal(controller.signal);

        expect(result).toEqual([["done"]]);
        expect(calls).toBe(3);
    });
});

describe("requestTimeout", () => {
    test("a query which exceeds the connection default fails with a TimeoutError", async () => {
        const { db, engine } = await connect({ requestTimeout: 30 });
        engine.respond = (_, options) => hang(options);

        const started = performance.now();
        const error = (await caught(db.query("SELECT * FROM slow").collect())) as Error;

        expect(error.name).toBe("TimeoutError");
        expect(performance.now() - started).toBeLessThan(1000);
    });

    test("it applies to responses(), to stream() and to every builder", async () => {
        const { db, engine } = await connect({ requestTimeout: 30 });
        engine.respond = (_, options) => hang(options);

        const reads: Promise<unknown>[] = [
            db.query("SELECT 1").responses(),
            drain(db.query("SELECT 1").stream()),
            Promise.resolve(db.select(person)),
            Promise.resolve(db.create(person).content({})),
            Promise.resolve(db.update(person).merge({})),
            Promise.resolve(db.upsert(person).merge({})),
            Promise.resolve(db.delete(person)),
            Promise.resolve(db.insert<{ name: string }>(person, [{ name: "n" }])),
            Promise.resolve(db.relate(new RecordId("a", 1), new Table("b"), new RecordId("c", 1))),
            Promise.resolve(db.run("fn::slow")),
            Promise.resolve(db.auth()),
            Promise.resolve(db.api().get("/slow")),
        ];

        for (const read of reads) {
            expect(((await caught(read)) as Error).name).toBe("TimeoutError");
        }
    });

    test("an engine which ignores signals is given up on too", async () => {
        const { db, engine } = await connect({ requestTimeout: 30 });
        engine.respond = stall;

        const started = performance.now();
        const error = (await caught(db.query("SELECT 1").collect())) as Error;

        expect(error.name).toBe("TimeoutError");
        expect(performance.now() - started).toBeLessThan(1000);
    });

    test("a query which finishes in time is unaffected, and nothing fires later", async () => {
        const { db, engine } = await connect({ requestTimeout: 50 });
        engine.respond = async () => ok(["in time"]);

        expect(await db.query("RETURN 1").collect()).toEqual([["in time"]]);
        await Bun.sleep(80);
    });

    test("a signal which aborts first is the reason, not a timeout", async () => {
        const { db, engine } = await connect({ requestTimeout: 5000 });
        const controller = new AbortController();
        const reason = new Error("client went away");
        engine.respond = (_, options) => hang(options);

        const running = db.query("SELECT 1").signal(controller.signal).collect();

        await Bun.sleep(5);
        controller.abort(reason);

        expect(await caught(running)).toBe(reason);
    });

    test("a timeout which fires first is distinguishable from the signal", async () => {
        const { db, engine } = await connect({ requestTimeout: 20 });
        const controller = new AbortController();
        engine.respond = (_, options) => hang(options);

        const error = (await caught(
            db.query("SELECT 1").signal(controller.signal).collect(),
        )) as Error;

        expect(error.name).toBe("TimeoutError");
        expect(controller.signal.aborted).toBe(false);
    });

    test("a query can allow itself longer than the default", async () => {
        const { db, engine } = await connect({ requestTimeout: 20 });
        engine.respond = async () => {
            await Bun.sleep(80);
            return ok(["slow but fine"]);
        };

        expect(((await caught(db.query("SELECT 1").collect())) as Error).name).toBe("TimeoutError");
        expect(await db.query("SELECT 1").requestTimeout(1000).collect()).toEqual([
            ["slow but fine"],
        ]);
        expect(await db.query("SELECT 1").requestTimeout(0).collect()).toEqual([["slow but fine"]]);
    });

    test("a query can be held to less than the default, and to a limit when there is none", async () => {
        const { db, engine } = await connect();
        engine.respond = (_, options) => hang(options);

        const error = (await caught(db.query("SELECT 1").requestTimeout(20).collect())) as Error;

        expect(error.name).toBe("TimeoutError");
    });

    test("it is never put in the query sent to the server", async () => {
        const { db, engine } = await connect({ requestTimeout: 5000 });

        await db.select(person).requestTimeout(2000);
        await db.query("RETURN 1").requestTimeout(2000);

        for (const { request } of engine.sent) {
            // The server's own limit is the TIMEOUT clause, which is not what this is
            expect(request.params?.[0]).not.toContain("TIMEOUT");
        }

        expect(signalOf(engine.sent[0])?.aborted).toBe(false);
    });

    test("each attempt of a retried query gets the whole of it", async () => {
        const { db, engine } = await connect({ requestTimeout: 60 });
        let calls = 0;
        engine.respond = async () => {
            await Bun.sleep(35);
            if (++calls < 3) throw conflict();
            return ok(["third time"]);
        };

        // Together the attempts take about 105ms, well over the 60ms limit of each
        const result = await db
            .query("UPDATE counter SET n += 1")
            .retry({ retryDelay: 0, retryDelayMax: 0 })
            .collect();

        expect(result).toEqual([["third time"]]);
        expect(calls).toBe(3);
    });

    test("a signal passed to .signal() bounds the whole of a retried query, unlike the timeout", async () => {
        const { db, engine } = await connect({ requestTimeout: 60 });
        engine.respond = async () => {
            await Bun.sleep(35);
            throw conflict();
        };

        const error = (await caught(
            db
                .query("UPDATE counter SET n += 1")
                .retry({ attempts: -1, retryDelay: 0, retryDelayMax: 0 })
                .signal(AbortSignal.timeout(100))
                .collect(),
        )) as Error;

        expect(error.name).toBe("TimeoutError");
    });

    test("it does not count the wait for a connection", async () => {
        // Awaiting `ready()` is not part of the request, and is only bounded by a signal
        const { db, engine } = await connect({ requestTimeout: 30 });
        engine.respond = async () => ok(["fine"]);

        expect(await db.query("RETURN 1").collect()).toEqual([["fine"]]);
    });

    test.each([-1, Number.NaN, Number.POSITIVE_INFINITY, "5000" as unknown as number])(
        "%p is rejected by the connection and by the query",
        async (value) => {
            const { db } = await connect();

            expect(() => db.query("RETURN 1").requestTimeout(value)).toThrow(/requestTimeout/);
            expect(() => db.select(person).requestTimeout(value)).toThrow(/requestTimeout/);
            expect(await caught(connectFake({ requestTimeout: value }))).toBeInstanceOf(
                SurrealError,
            );
        },
    );
});

// Every builder takes `.signal()` and `.requestTimeout()` the way a query does
const builders: [string, (db: Surreal) => ReturnType<Surreal["select"]> | Promise<unknown>][] = [
    ["select", (db) => db.select(person)],
    ["create", (db) => db.create(person).content({})],
    ["update", (db) => db.update(person).merge({})],
    ["upsert", (db) => db.upsert(person).merge({})],
    ["delete", (db) => db.delete(person)],
    ["insert", (db) => db.insert<{ name: string }>(person, [{ name: "n" }])],
    ["relate", (db) => db.relate(new RecordId("a", 1), new Table("b"), new RecordId("c", 1))],
    ["run", (db) => db.run("fn::slow")],
    ["auth", (db) => db.auth()],
    ["api", (db) => db.api().get("/slow")],
];

type Chainable = Promise<unknown> & {
    signal(signal: AbortSignal | undefined): Chainable;
    requestTimeout(milliseconds: number): Chainable;
    stream(): AsyncIterable<unknown>;
};

describe.each(builders)("%s", (_, make) => {
    const builder = (db: Surreal) => make(db) as unknown as Chainable;

    test("is not sent when the signal has aborted already", async () => {
        const { db, engine } = await connect();
        const reason = new Error("client went away");
        const controller = new AbortController();
        controller.abort(reason);

        expect(await caught(Promise.resolve(builder(db).signal(controller.signal)))).toBe(reason);
        expect(await caught(drain(builder(db).signal(controller.signal).stream()))).toBe(reason);
        expect(engine.sent).toEqual([]);
    });

    test("stops waiting with the reason when the signal aborts", async () => {
        const { db, engine } = await connect();
        const reason = new Error("client went away");
        const controller = new AbortController();
        engine.respond = (_, options) => hang(options);

        const running = Promise.resolve(builder(db).signal(controller.signal));

        await Bun.sleep(1);
        controller.abort(reason);

        expect(await caught(running)).toBe(reason);
    });

    test("stops waiting with a TimeoutError when its request timeout passes", async () => {
        const { db, engine } = await connect();
        engine.respond = (_, options) => hang(options);

        const error = (await caught(Promise.resolve(builder(db).requestTimeout(20)))) as Error;

        expect(error.name).toBe("TimeoutError");
    });

    test("combines with other signals", async () => {
        const { db, engine } = await connect();
        const first = new AbortController();
        const second = new AbortController();
        const reason = new Error("second");
        engine.respond = (_, options) => hang(options);

        const running = Promise.resolve(
            builder(db).signal(first.signal).signal(second.signal).requestTimeout(5000),
        );

        await Bun.sleep(1);
        second.abort(reason);

        expect(await caught(running)).toBe(reason);
    });

    test("leaves what it does alone when given nothing", async () => {
        const { db, engine } = await connect();
        engine.respond = async () => ok([]);

        await builder(db)
            .signal(undefined)
            .catch(() => {});

        expect(engine.sent).toHaveLength(1);
        expect(signalOf(engine.sent[0])).toBeUndefined();
    });
});

describe("withSignal", () => {
    const scoped = [
        ["query", (s: ReturnType<Surreal["withSignal"]>) => s.query("RETURN 1")],
        ["select", (s: ReturnType<Surreal["withSignal"]>) => s.select(person)],
        ["create", (s: ReturnType<Surreal["withSignal"]>) => s.create(person).content({})],
        ["update", (s: ReturnType<Surreal["withSignal"]>) => s.update(person).merge({})],
        ["upsert", (s: ReturnType<Surreal["withSignal"]>) => s.upsert(person).merge({})],
        ["delete", (s: ReturnType<Surreal["withSignal"]>) => s.delete(person)],
        [
            "insert",
            (s: ReturnType<Surreal["withSignal"]>) =>
                s.insert<{ name: string }>(person, [{ name: "n" }]),
        ],
        [
            "relate",
            (s: ReturnType<Surreal["withSignal"]>) =>
                s.relate(new RecordId("a", 1), new Table("b"), new RecordId("c", 1)),
        ],
        ["run", (s: ReturnType<Surreal["withSignal"]>) => s.run("fn::slow")],
        ["auth", (s: ReturnType<Surreal["withSignal"]>) => s.auth()],
        ["api", (s: ReturnType<Surreal["withSignal"]>) => s.api().get("/slow")],
    ] as const;

    test.each(scoped)("%s inherits the signal without being given one", async (_, make) => {
        const { db, engine } = await connect();
        const reason = new Error("client went away");
        const controller = new AbortController();
        engine.respond = (_, options) => hang(options);

        const running = Promise.resolve(make(db.withSignal(controller.signal)));

        await Bun.sleep(1);
        controller.abort(reason);

        expect(await caught(running)).toBe(reason);
    });

    test.each(scoped)("%s is not sent once the signal has aborted", async (_, make) => {
        const { db, engine } = await connect();
        const reason = new Error("client went away");
        const controller = new AbortController();
        controller.abort(reason);

        expect(await caught(Promise.resolve(make(db.withSignal(controller.signal))))).toBe(reason);
        expect(engine.sent).toEqual([]);
    });

    test("the signal of a call is combined with the one of the scope", async () => {
        const { db, engine } = await connect();
        engine.respond = (_, options) => hang(options);

        const scope = new AbortController();
        const call = new AbortController();
        const scopeReason = new Error("the request went away");
        const callReason = new Error("this call gave up");

        const scopeFirst = Promise.resolve(
            db.withSignal(scope.signal).select(person).signal(call.signal),
        );
        await Bun.sleep(1);
        scope.abort(scopeReason);
        expect(await caught(scopeFirst)).toBe(scopeReason);

        const callFirst = Promise.resolve(
            db.withSignal(new AbortController().signal).select(person).signal(call.signal),
        );
        await Bun.sleep(1);
        call.abort(callReason);
        expect(await caught(callFirst)).toBe(callReason);
    });

    test("scopes nest, and the signals of all of them apply", async () => {
        const { db, engine } = await connect();
        engine.respond = (_, options) => hang(options);

        const outer = new AbortController();
        const inner = new AbortController();
        const reason = new Error("outer");
        const nested = db.withSignal(outer.signal).withSignal(inner.signal).withSignal(undefined);

        const running = Promise.resolve(nested.select(person));

        await Bun.sleep(1);
        outer.abort(reason);

        expect(await caught(running)).toBe(reason);
    });

    test("it does not change the connection it was made from", async () => {
        const { db, engine } = await connect();
        const controller = new AbortController();

        const scope = db.withSignal(controller.signal);
        controller.abort(new Error("client went away"));

        // The scope is spent, and the session it came from is not
        await caught(Promise.resolve(scope.select(person)));
        await db.select(person);

        expect(engine.sent).toHaveLength(1);
        expect(signalOf(engine.sent[0])).toBeUndefined();
    });

    test("one request's scope does not affect another's", async () => {
        const { db, engine } = await connect();
        const gone = new AbortController();
        const staying = new AbortController();
        engine.respond = async (_, options) => {
            await Bun.sleep(10);
            if (options?.signal?.aborted) throw options.signal.reason;
            return ok(["done"]);
        };

        const first = Promise.resolve(db.withSignal(gone.signal).select(person));
        const second = Promise.resolve(db.withSignal(staying.signal).select(person));

        gone.abort(new Error("client went away"));

        await caught(first);
        expect((await second) as unknown).toEqual(["done"]);
    });

    test("a scope is a SurrealRequestScope, and so is one made from it", async () => {
        const { db } = await connect();
        const controller = new AbortController();
        const scope = db.withSignal(controller.signal);

        expect(scope).toBeInstanceOf(SurrealRequestScope);
        expect(scope.withSignal(undefined)).toBeInstanceOf(SurrealRequestScope);
    });

    test("a scope without a signal is a plain session", async () => {
        const { db, engine } = await connect();

        await db.withSignal(undefined).select(person);

        expect(signalOf(engine.sent[0])).toBeUndefined();
    });

    test("it can be made from a session, and from a transaction", async () => {
        const { db, engine } = await connect();
        const txn = Uuid.v4();
        engine.respond = async (request) => (request.method === "begin" ? txn : ok([]));
        const controller = new AbortController();
        const reason = new Error("client went away");

        const session = db.withSignal(controller.signal);
        const transaction = await session.beginTransaction();

        engine.respond = (_, options) => hang(options);
        const running = Promise.resolve(transaction.select(person));

        await Bun.sleep(1);
        controller.abort(reason);

        expect(await caught(running)).toBe(reason);

        // The transaction is the one which was begun
        expect(engine.sent.find((s) => s.request.method === "query")?.request.txn).toEqual(txn);
    });
});

describe("transactions and signals", () => {
    test("beginning a transaction is not done for a signal which has aborted", async () => {
        const { db, engine } = await connect();
        const reason = new Error("client went away");
        const controller = new AbortController();
        controller.abort(reason);

        expect(await caught(db.withSignal(controller.signal).beginTransaction())).toBe(reason);
        expect(engine.sent).toEqual([]);
    });

    test("every query of a scoped transaction is bound to the signal", async () => {
        const { db, engine } = await connect();
        const txn = Uuid.v4();
        const controller = new AbortController();
        const reason = new Error("client went away");
        engine.respond = async (request) => (request.method === "begin" ? txn : ok(["row"]));

        const transaction = await db.withSignal(controller.signal).beginTransaction();

        expect((await transaction.select(person)) as unknown).toEqual(["row"]);
        expect(signalOf(engine.sent.find((s) => s.request.method === "query"))?.aborted).toBe(
            false,
        );

        engine.respond = (_, options) => hang(options);
        const running = Promise.resolve(transaction.create(person).content({}));

        await Bun.sleep(1);
        controller.abort(reason);

        expect(await caught(running)).toBe(reason);
        expect(await caught(Promise.resolve(transaction.select(person)))).toBe(reason);
    });

    test("committing is not bound to the signal", async () => {
        const { db, engine } = await connect();
        const txn = Uuid.v4();
        const controller = new AbortController();
        engine.respond = async (request) => (request.method === "begin" ? txn : ok([]));

        const transaction = await db.withSignal(controller.signal).beginTransaction();

        controller.abort(new Error("client went away"));
        engine.respond = async () => undefined;
        await transaction.commit();

        const commit = engine.sent.find((s) => s.request.method === "commit");

        expect(commit?.request.params).toEqual([txn]);
        expect(commit?.options).toBeUndefined();
    });

    test("a transaction begun on the server after the abort is cancelled", async () => {
        const { db, engine } = await connect();
        const txn = Uuid.v4();
        const controller = new AbortController();
        const reason = new Error("client went away");
        let begin: (id: Uuid) => void = () => {};

        engine.respond = (request) => {
            if (request.method === "begin") {
                return new Promise<Uuid>((resolve) => {
                    begin = resolve;
                });
            }

            return Promise.resolve(undefined);
        };

        const beginning = db.withSignal(controller.signal).beginTransaction();

        await Bun.sleep(1);
        controller.abort(reason);

        expect(await caught(beginning)).toBe(reason);

        // The server answers anyway, with a transaction nobody holds
        begin(txn);
        await Bun.sleep(5);

        const cancel = engine.sent.find((s) => s.request.method === "cancel");

        expect(cancel?.request.params).toEqual([txn]);
    });

    test("a transaction can be given a signal after it has begun", async () => {
        const { db, engine } = await connect();
        const txn = Uuid.v4();
        const controller = new AbortController();
        const reason = new Error("client went away");
        engine.respond = async (request) => (request.method === "begin" ? txn : ok([]));

        const plain = await db.beginTransaction();
        const bound = plain.withSignal(controller.signal);

        engine.respond = (_, options) => hang(options);
        const running = Promise.resolve(bound.select(person));
        const unbound = Promise.resolve(plain.select(person));

        await Bun.sleep(1);
        controller.abort(reason);

        expect(await caught(running)).toBe(reason);

        // Only the handle which was given the signal is bound to it
        const queries = engine.sent.filter((s) => s.request.method === "query");

        expect(queries.map((q) => signalOf(q) === undefined).sort()).toEqual([false, true]);
        unbound.catch(() => {});

        // And it is the same transaction, which either handle can end
        engine.respond = async () => undefined;
        await bound.cancel();
        expect(engine.sent.find((s) => s.request.method === "cancel")?.request.params).toEqual([
            txn,
        ]);
    });
});

describe("diagnostics", () => {
    test("the signal reaches an engine wrapped for diagnostics", async () => {
        const { FakeEngine } = await import("../__helpers__/mock-engine");
        const engine = new FakeEngine({
            options: {},
            uniqueId: () => "fake",
            codecs: undefined as never,
        });
        const events: unknown[] = [];

        const db = new Surreal({
            engines: applyDiagnostics({ fake: () => engine }, (event) => events.push(event)),
        });
        open = db;
        await db.connect("fake://", { versionCheck: false });

        const controller = new AbortController();
        engine.respond = (_, options) => hang(options);

        const running = db.query("SELECT 1").signal(controller.signal).collect();

        await Bun.sleep(1);
        const handed = signalOf(engine.sent[0]);
        expect(handed).toBeDefined();

        const reason = new Error("client went away");
        controller.abort(reason);

        expect(handed?.aborted).toBe(true);
        expect(await caught(running)).toBe(reason);
    });
});
