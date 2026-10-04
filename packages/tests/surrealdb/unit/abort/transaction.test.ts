import { afterEach, describe, expect, test } from "bun:test";
import {
    type QueryChunk,
    QueryError,
    type Surreal,
    SurrealError,
    surql,
    ThrownError,
} from "surrealdb";
import { connectFake, hang, stall } from "../__helpers__/mock-engine";

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

// What a 3.x server answers a BEGIN ... COMMIT query with: a result for each statement, and for
// the BEGIN and COMMIT around them
const statement = (result: unknown = null) => ({
    status: "OK",
    time: "1ms",
    result,
    type: "other",
});

const committed = (...results: unknown[]) => [
    statement(),
    ...results.map((result) => statement(result)),
    statement(),
];

const notExecuted = {
    status: "ERR",
    time: "1ms",
    result: "The query was not executed due to a failed transaction",
    kind: "Query",
    details: { kind: "NotExecuted" },
};

const conflictOnCommit = () => [
    statement(),
    notExecuted,
    {
        status: "ERR",
        time: "1ms",
        result: "Cannot COMMIT: Transaction conflict: Write conflict. This transaction can be retried",
        kind: "Query",
        details: { kind: "TransactionConflict" },
    },
];

const FAST_RETRY = { retryDelay: 0, retryDelayMax: 0, retryDelayJitter: 0 };
const SLOW_RETRY = { retryDelay: 5000, retryDelayMax: 5000, retryDelayJitter: 0 };

describe("transaction() and signals", () => {
    test("is answered as before when nothing aborts, and is handed the signal", async () => {
        const { db, engine } = await connect();
        const controller = new AbortController();
        engine.respond = async () => committed("a", "b");

        const results = await db.transaction(["'a'", "'b'"], { signal: controller.signal });

        expect(results).toEqual(["a", "b"]);
        expect(engine.sent).toHaveLength(1);
        expect(String(engine.sent[0]?.request.params?.[0])).toStartWith("BEGIN;");
        expect(engine.sent[0]?.options?.signal?.aborted).toBe(false);
    });

    test("a transaction with no signal is handed none", async () => {
        const { db, engine } = await connect();
        engine.respond = async () => committed("a");

        await db.transaction(["'a'"]);

        expect(engine.sent[0]?.options?.signal).toBeUndefined();
    });

    test("a signal which has aborted already means nothing is sent", async () => {
        const { db, engine } = await connect();
        const reason = new Error("client went away");
        const controller = new AbortController();
        controller.abort(reason);

        expect(await caught(db.transaction(["'a'"], { signal: controller.signal }))).toBe(reason);
        // Even one which has nothing to run, which is otherwise a transaction of no statements
        expect(await caught(db.transaction([], { signal: controller.signal }))).toBe(reason);
        expect(engine.sent).toEqual([]);
    });

    test("aborting mid-flight rejects with the reason, however the engine takes it", async () => {
        const { db, engine } = await connect();

        for (const respond of [hang, stall]) {
            const controller = new AbortController();
            const reason = new Error("client went away");
            const started = performance.now();
            engine.respond = (_, options) => respond(options);

            const running = db.transaction(["CREATE person"], { signal: controller.signal });

            await Bun.sleep(5);
            controller.abort(reason);

            expect(await caught(running)).toBe(reason);
            expect(performance.now() - started).toBeLessThan(1000);
        }
    });

    test("an abort is reported as an AbortError or a TimeoutError as it is given", async () => {
        const { db, engine } = await connect();
        engine.respond = (_, options) => hang(options);

        const aborted = new AbortController();
        const running = db.transaction(["CREATE person"], { signal: aborted.signal });
        await Bun.sleep(1);
        aborted.abort();

        expect(((await caught(running)) as Error).name).toBe("AbortError");

        const error = (await caught(
            db.transaction(["CREATE person"], { signal: AbortSignal.timeout(20) }),
        )) as Error;

        expect(error.name).toBe("TimeoutError");
        expect(error).not.toBeInstanceOf(SurrealError);
    });

    test("the requestTimeout of the connection applies, and the option overrides it", async () => {
        const { db, engine } = await connect({ requestTimeout: 25 });
        engine.respond = async (_, options) => {
            await Bun.sleep(80);
            if (options?.signal?.aborted) throw options.signal.reason;
            return committed("slow but fine");
        };

        expect(((await caught(db.transaction(["'a'"]))) as Error).name).toBe("TimeoutError");
        expect(await db.transaction(["'a'"], { requestTimeout: 1000 })).toEqual(["slow but fine"]);
        expect(await db.transaction(["'a'"], { requestTimeout: 0 })).toEqual(["slow but fine"]);
    });

    test("a requestTimeout given to a transaction limits it when the connection has none", async () => {
        const { db, engine } = await connect();
        engine.respond = (_, options) => hang(options);

        const error = (await caught(db.transaction(["'a'"], { requestTimeout: 20 }))) as Error;

        expect(error.name).toBe("TimeoutError");
    });

    test("an invalid requestTimeout is refused and nothing is sent", async () => {
        const { db, engine } = await connect();

        for (const value of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
            expect(await caught(db.transaction(["'a'"], { requestTimeout: value }))).toBeInstanceOf(
                SurrealError,
            );
        }

        expect(engine.sent).toEqual([]);
    });

    test("an unscoped transaction is not bound to the signal of anything else", async () => {
        const { db, engine } = await connect();
        const controller = new AbortController();
        engine.respond = async () => committed("a");

        db.withSignal(controller.signal);
        controller.abort();

        expect(await db.transaction(["'a'"])).toEqual(["a"]);
    });
});

describe("transaction() on a request scope", () => {
    test("inherits the signal without being given one", async () => {
        const { db, engine } = await connect();
        const reason = new Error("the request went away");
        const controller = new AbortController();
        engine.respond = (_, options) => hang(options);

        const running = db.withSignal(controller.signal).transaction(["CREATE person"]);

        await Bun.sleep(5);
        expect(engine.sent[0]?.options?.signal?.aborted).toBe(false);
        controller.abort(reason);

        expect(await caught(running)).toBe(reason);
        expect(engine.sent[0]?.options?.signal?.reason).toBe(reason);
    });

    test("sends nothing once the signal of the scope has aborted", async () => {
        const { db, engine } = await connect();
        const reason = new Error("the request went away");
        const controller = new AbortController();
        controller.abort(reason);

        expect(await caught(db.withSignal(controller.signal).transaction(["'a'"]))).toBe(reason);
        expect(engine.sent).toEqual([]);
    });

    test("combines the signal of the scope with one given to the call", async () => {
        const { db, engine } = await connect();
        engine.respond = (_, options) => hang(options);

        const scope = new AbortController();
        const call = new AbortController();
        const scopeReason = new Error("the request went away");
        const callReason = new Error("this call gave up");

        const first = db
            .withSignal(scope.signal)
            .transaction(["CREATE person"], { signal: call.signal });
        await Bun.sleep(5);
        scope.abort(scopeReason);
        expect(await caught(first)).toBe(scopeReason);

        const second = db
            .withSignal(new AbortController().signal)
            .transaction(["CREATE person"], { signal: call.signal });
        await Bun.sleep(5);
        call.abort(callReason);
        expect(await caught(second)).toBe(callReason);
    });

    test("holds to the requestTimeout of the options, and of the connection", async () => {
        const { db, engine } = await connect({ requestTimeout: 25 });
        const scoped = db.withSignal(new AbortController().signal);
        engine.respond = (_, options) => hang(options);

        expect(((await caught(scoped.transaction(["'a'"]))) as Error).name).toBe("TimeoutError");

        engine.respond = async () => committed("a");
        expect(await scoped.transaction(["'a'"], { requestTimeout: 0 })).toEqual(["a"]);
    });

    test("is the same atomic request which the session sends, and refuses what the session refuses", async () => {
        const { db, engine } = await connect();
        const scoped = db.withSignal(new AbortController().signal);
        engine.respond = async () => committed("a", "b");

        expect(
            await scoped.transaction<[string, string]>([
                "'a'",
                surql`SELECT * FROM person WHERE name = ${"b"}`,
            ]),
        ).toEqual(["a", "b"]);
        expect(String(engine.sent[0]?.request.params?.[0])).toStartWith("BEGIN;");

        expect(await caught(scoped.transaction(["BEGIN"]))).toBeInstanceOf(Error);
        expect(await caught(scoped.transaction("'a'" as never))).toBeInstanceOf(Error);
        expect(engine.sent).toHaveLength(1);
    });

    test("a scope made from a scope binds the transaction to both", async () => {
        const { db, engine } = await connect();
        engine.respond = (_, options) => hang(options);

        const outer = new AbortController();
        const inner = new AbortController();
        const reason = new Error("outer");

        const running = db
            .withSignal(outer.signal)
            .withSignal(inner.signal)
            .transaction(["CREATE person"]);

        await Bun.sleep(5);
        outer.abort(reason);

        expect(await caught(running)).toBe(reason);
    });
});

describe("transaction() retries and signals", () => {
    test("a transaction which conflicts is retried until it succeeds, a signal which never aborts changing nothing", async () => {
        const { db, engine } = await connect();
        const controller = new AbortController();
        let calls = 0;
        engine.respond = async () => (++calls < 3 ? conflictOnCommit() : committed("done"));

        const results = await db.transaction(["CREATE person"], {
            retry: { enabled: true, ...FAST_RETRY },
            signal: controller.signal,
        });

        expect(results).toEqual(["done"]);
        expect(calls).toBe(3);
    });

    test("aborting while waiting to retry stops the retrying, and rejects with the reason", async () => {
        const { db, engine } = await connect();
        const controller = new AbortController();
        const reason = new Error("client went away");
        const started = performance.now();
        engine.respond = async () => conflictOnCommit();

        const running = db.transaction(["CREATE person"], {
            retry: { enabled: true, ...SLOW_RETRY },
            signal: controller.signal,
        });

        setTimeout(() => controller.abort(reason), 30);

        expect(await caught(running)).toBe(reason);
        expect(engine.sent).toHaveLength(1);
        expect(performance.now() - started).toBeLessThan(1000);
    });

    test("a signal which aborted during an attempt means the conflict is not retried", async () => {
        const { db, engine } = await connect();
        const controller = new AbortController();
        const reason = new Error("client went away");
        engine.respond = async () => {
            controller.abort(reason);
            return conflictOnCommit();
        };

        const running = db.transaction(["CREATE person"], {
            retry: { enabled: true, ...FAST_RETRY },
            signal: controller.signal,
        });

        expect(await caught(running)).toBe(reason);
        expect(engine.sent).toHaveLength(1);
    });

    test("the scope of a request stops the retrying too", async () => {
        const { db, engine } = await connect();
        const controller = new AbortController();
        const reason = new Error("the request went away");
        engine.respond = async () => conflictOnCommit();

        const running = db.withSignal(controller.signal).transaction(["CREATE person"], {
            retry: { enabled: true, ...SLOW_RETRY },
        });

        setTimeout(() => controller.abort(reason), 30);

        expect(await caught(running)).toBe(reason);
        expect(engine.sent).toHaveLength(1);
    });

    test("each attempt gets the whole of the request timeout, and an overall signal still bounds them", async () => {
        const { db, engine } = await connect({ requestTimeout: 60 });
        let calls = 0;
        engine.respond = async () => {
            await Bun.sleep(35);
            return ++calls < 3 ? conflictOnCommit() : committed("third time");
        };

        // About 105ms in all, well over the limit of 60ms which each attempt has
        expect(
            await db.transaction(["CREATE person"], {
                retry: { enabled: true, ...FAST_RETRY },
            }),
        ).toEqual(["third time"]);

        calls = -1000;
        const error = (await caught(
            db.transaction(["CREATE person"], {
                retry: { enabled: true, attempts: -1, ...FAST_RETRY },
                signal: AbortSignal.timeout(100),
            }),
        )) as Error;

        expect(error.name).toBe("TimeoutError");
    });

    test("an error which is not a conflict is thrown as it is, not as the abort", async () => {
        const { db, engine } = await connect();
        const controller = new AbortController();
        engine.respond = async () => [
            statement(),
            {
                status: "ERR",
                time: "1ms",
                result: "An error occurred: boom",
                kind: "Thrown",
            },
            {
                ...notExecuted,
                result: "Cannot COMMIT: the transaction was aborted due to a prior error",
            },
        ];

        const error = await caught(
            db.transaction(["THROW 'boom'"], {
                retry: { enabled: true, ...FAST_RETRY },
                signal: controller.signal,
            }),
        );

        expect(error).toBeInstanceOf(ThrownError);
        expect(engine.sent).toHaveLength(1);
    });
});

describe("collect() and the root cause of a transaction", () => {
    test("still throws the error which made a transaction fail, not one of the others", async () => {
        const { db, engine } = await connect();
        const controller = new AbortController();
        engine.respond = async () => conflictOnCommit();

        const error = await caught(
            db.query("BEGIN; CREATE person; COMMIT;").signal(controller.signal).collect(),
        );

        expect(error).toBeInstanceOf(QueryError);
        expect((error as QueryError).isTransactionConflict).toBe(true);
    });

    test("a transaction in a query which is retried is retried on its root cause, under a signal", async () => {
        const { db, engine } = await connect();
        const controller = new AbortController();
        let calls = 0;
        engine.respond = async () =>
            ++calls < 3 ? conflictOnCommit() : [statement(), statement("created"), statement()];

        const results = await db
            .query("BEGIN; CREATE person; COMMIT;")
            .retry({ enabled: true, ...FAST_RETRY })
            .signal(controller.signal)
            .collect();

        expect(calls).toBe(3);
        expect(results).toEqual([null, "created", null]);
    });

    test("an abort wins over the errors of a transaction which are still being read", async () => {
        const { db, engine } = await connect();
        const controller = new AbortController();
        const reason = new Error("client went away");
        const secondary = new QueryError({
            kind: "Query",
            message: "The query was not executed due to a failed transaction",
            details: { kind: "NotExecuted" },
        });
        let returned = 0;

        // The statements before the failing one are reported, and then nothing for a while
        engine.queryImpl = () => ({
            [Symbol.asyncIterator]: () => {
                let sent = false;

                return {
                    next: () => {
                        if (!sent) {
                            sent = true;
                            const chunk: QueryChunk<unknown> = {
                                query: 0,
                                batch: 0,
                                kind: "single",
                                error: secondary,
                            };

                            return Promise.resolve({ done: false as const, value: chunk });
                        }

                        return new Promise<never>(() => {});
                    },
                    return: async () => {
                        returned++;
                        return { done: true as const, value: undefined };
                    },
                };
            },
        });

        const running = db
            .query("BEGIN; CREATE person; COMMIT;")
            .signal(controller.signal)
            .collect();

        await Bun.sleep(5);
        controller.abort(reason);

        // The abort, and not the error of the statement which did not run
        expect(await caught(running)).toBe(reason);
        expect(returned).toBe(1);
    });

    test("a root cause which is found stops the reading, and releases the stream", async () => {
        const { db, engine } = await connect();
        const controller = new AbortController();
        const failure = new ThrownError({ kind: "Thrown", message: "An error occurred: boom" });
        let returned = 0;
        let pulled = 0;

        engine.queryImpl = () => ({
            [Symbol.asyncIterator]: () => ({
                next: async () => {
                    pulled++;

                    const chunk: QueryChunk<unknown> =
                        pulled === 1
                            ? { query: 0, batch: 0, kind: "single", error: failure }
                            : { query: 1, batch: 0, kind: "single", result: [1], type: "other" };

                    return { done: false as const, value: chunk };
                },
                return: async () => {
                    returned++;
                    return { done: true as const, value: undefined };
                },
            }),
        });

        const error = await caught(
            db.query("BEGIN; THROW 'boom'; COMMIT;").signal(controller.signal).collect(),
        );

        expect(error).toBe(failure);
        expect(pulled).toBe(1);
        expect(returned).toBe(1);
    });
});

describe("query([...]) and signals", () => {
    test("a list of queries is sent as one query, and is abandoned by a signal", async () => {
        const { db, engine } = await connect();
        const controller = new AbortController();
        const reason = new Error("client went away");
        engine.respond = (_, options) => hang(options);

        const running = db
            .query(["SELECT 1", surql`SELECT * FROM person WHERE name = ${"a"}`])
            .signal(controller.signal)
            .collect();

        await Bun.sleep(5);

        expect(engine.sent).toHaveLength(1);
        expect(String(engine.sent[0]?.request.params?.[0])).toContain("SELECT 1");
        expect(String(engine.sent[0]?.request.params?.[0])).toContain("SELECT * FROM person");

        controller.abort(reason);

        expect(await caught(running)).toBe(reason);
    });

    test("a signal which has aborted already means nothing is sent", async () => {
        const { db, engine } = await connect();
        const reason = new Error("client went away");
        const controller = new AbortController();
        controller.abort(reason);

        expect(await caught(db.query(["SELECT 1"]).signal(controller.signal).collect())).toBe(
            reason,
        );
        expect(await caught(db.query(["SELECT 1"]).signal(controller.signal).responses())).toBe(
            reason,
        );
        expect(engine.sent).toEqual([]);
    });

    test("a request scope binds it, and the requestTimeout applies", async () => {
        const { db, engine } = await connect({ requestTimeout: 25 });
        const controller = new AbortController();
        const reason = new Error("the request went away");
        engine.respond = (_, options) => hang(options);

        const timedOut = await caught(
            db.withSignal(controller.signal).query(["SELECT 1"]).collect(),
        );
        expect((timedOut as Error).name).toBe("TimeoutError");

        const running = db
            .withSignal(controller.signal)
            .query(["SELECT 1"])
            .requestTimeout(0)
            .collect();

        await Bun.sleep(5);
        controller.abort(reason);

        expect(await caught(running)).toBe(reason);
    });

    test("what is configured on the inputs is left out of the combined query, signals included", async () => {
        const { db, engine } = await connect();
        const gone = new AbortController();
        gone.abort(new Error("an input's own signal"));
        engine.respond = async () => [statement(1), statement(2)];

        const results = await db
            .query([
                db.query("SELECT 1").signal(gone.signal),
                db.select(new (await import("surrealdb")).Table("person")).signal(gone.signal),
            ])
            .collect();

        expect(engine.sent).toHaveLength(1);
        expect(results).toEqual([1, 2]);
    });
});
