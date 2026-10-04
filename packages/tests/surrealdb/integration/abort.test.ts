import { describe, expect, test } from "bun:test";
import { Features, QueryError, RecordId, ServerError, Table } from "surrealdb";
import { createIdleSurreal, createSurreal, requestVersion, SURREAL_PROTOCOL } from "./__helpers__";

const { is3x } = await requestVersion();

// A statement far slower than any of these tests is willing to wait
const SLOW = "SLEEP 5s";

// How long a query abandoned after a fraction of a second is allowed to take to report it. Far
// below SLOW, and generous enough for a loaded machine.
const PROMPT = 2000;

async function caught(promise: Promise<unknown>): Promise<unknown> {
    try {
        await promise;
    } catch (error) {
        return error;
    }

    throw new Error("Expected the promise to reject");
}

/**
 * Define a function which takes as long as SLOW, to be called with the `run()` builder.
 *
 * `sleep(5s)` itself cannot be called with `run()`: at the start of a statement SurrealDB 2.x
 * reads `sleep` as the keyword of the SLEEP statement, and rejects the call as a parse error. Inside
 * a function body it is an expression, which every supported server runs.
 */
async function defineSlowFunction(surreal: { query(sql: string): PromiseLike<unknown> }) {
    await surreal.query(/* surql */ `DEFINE FUNCTION fn::slow() { RETURN sleep(5s); }`);
}

/** How long something takes, and what it returned. */
async function timed<T>(run: () => Promise<T>): Promise<{ ms: number; value: T }> {
    const started = performance.now();
    const value = await run();

    return { ms: performance.now() - started, value };
}

describe.if(SURREAL_PROTOCOL === "ws" || SURREAL_PROTOCOL === "http")("abort signals", () => {
    test("a slow query is abandoned promptly and reports the reason of the signal", async () => {
        const surreal = await createSurreal();
        const controller = new AbortController();
        const reason = new Error("the client went away");

        setTimeout(() => controller.abort(reason), 100);

        const { ms, value } = await timed(() =>
            caught(surreal.query(SLOW).signal(controller.signal).collect()),
        );

        expect(value).toBe(reason);
        expect(ms).toBeLessThan(PROMPT);
    });

    test("AbortSignal.timeout() is reported as the TimeoutError it is", async () => {
        const surreal = await createSurreal();

        const { ms, value } = await timed(() =>
            caught(surreal.query(SLOW).signal(AbortSignal.timeout(150)).collect()),
        );

        expect((value as Error).name).toBe("TimeoutError");
        expect(ms).toBeLessThan(PROMPT);
    });

    test("an aborted query reports an AbortError when no reason is given", async () => {
        const surreal = await createSurreal();
        const controller = new AbortController();

        setTimeout(() => controller.abort(), 100);

        const error = (await caught(
            surreal.query(SLOW).signal(controller.signal).collect(),
        )) as Error;

        expect(error.name).toBe("AbortError");
    });

    test("the connection remains usable after queries have been abandoned", async () => {
        const surreal = await createSurreal();

        await caught(surreal.query(SLOW).signal(AbortSignal.timeout(100)).collect());

        const { ms, value } = await timed(() => surreal.query("RETURN 1 + 1").collect<[number]>());

        expect(value).toEqual([2]);
        expect(ms).toBeLessThan(PROMPT);
    });

    test("many abandoned queries leave nothing behind", async () => {
        const surreal = await createSurreal();
        const controller = new AbortController();

        const abandoned = Array.from({ length: 25 }, () =>
            caught(surreal.query(SLOW).signal(controller.signal).collect()),
        );

        await Bun.sleep(100);
        controller.abort(new Error("done with all of these"));

        const errors = await Promise.all(abandoned);

        expect(errors.every((error) => (error as Error).message === "done with all of these")).toBe(
            true,
        );

        const { ms, value } = await timed(() => surreal.query("RETURN 1").collect<[number]>());

        expect(value).toEqual([1]);
        expect(ms).toBeLessThan(PROMPT);
    });

    test("a signal which has aborted already means nothing is sent", async () => {
        const surreal = await createSurreal();
        await surreal.query(/* surql */ `DEFINE TABLE person SCHEMALESS`);

        const controller = new AbortController();
        const reason = new Error("never started");
        controller.abort(reason);

        const attempts = [
            surreal.query("CREATE person:one").signal(controller.signal).collect(),
            surreal.query("CREATE person:one").signal(controller.signal).responses(),
            surreal.create(new RecordId("person", "one")).signal(controller.signal),
            surreal.insert(new Table("person"), [{ id: "one" }]).signal(controller.signal),
            (async () => {
                for await (const _ of surreal
                    .query("CREATE person:one")
                    .signal(controller.signal)
                    .stream()) {
                    // Nothing to read
                }
            })(),
        ];

        for (const attempt of attempts) {
            expect(await caught(attempt)).toBe(reason);
        }

        const [people] = await surreal.query("SELECT * FROM person").collect<[unknown[]]>();

        expect(people).toEqual([]);
    });

    test("responses() is abandoned too", async () => {
        const surreal = await createSurreal();

        const { ms, value } = await timed(() =>
            caught(surreal.query(SLOW).signal(AbortSignal.timeout(100)).responses()),
        );

        expect((value as Error).name).toBe("TimeoutError");
        expect(ms).toBeLessThan(PROMPT);
    });

    test("a stream ends with the reason when the signal aborts", async () => {
        const surreal = await createSurreal();
        const controller = new AbortController();
        const reason = new Error("the client went away");

        setTimeout(() => controller.abort(reason), 100);

        const { ms, value } = await timed(() =>
            caught(
                (async () => {
                    for await (const _ of surreal
                        .query(`${SLOW}; RETURN 1`)
                        .signal(controller.signal)
                        .stream()) {
                        // Nothing arrives before the slow statement is done
                    }
                })(),
            ),
        );

        expect(value).toBe(reason);
        expect(ms).toBeLessThan(PROMPT);

        // And whatever the stream held has been let go of
        expect(await surreal.query("RETURN 1").collect()).toEqual([1]);
    });

    test("a builder is abandoned promptly, awaited or streamed", async () => {
        const surreal = await createSurreal();
        await defineSlowFunction(surreal);

        const awaited = await timed(() =>
            caught(Promise.resolve(surreal.run("fn::slow").signal(AbortSignal.timeout(100)))),
        );

        expect((awaited.value as Error).name).toBe("TimeoutError");
        expect(awaited.ms).toBeLessThan(PROMPT);

        const controller = new AbortController();
        const reason = new Error("the client went away");

        setTimeout(() => controller.abort(reason), 100);

        const streamed = await timed(() =>
            caught(
                (async () => {
                    for await (const _ of surreal
                        .run("fn::slow")
                        .signal(controller.signal)
                        .stream()) {
                        // Nothing arrives
                    }
                })(),
            ),
        );

        expect(streamed.value).toBe(reason);
        expect(streamed.ms).toBeLessThan(PROMPT);
    });

    test("a query which is not aborted is not disturbed by a signal", async () => {
        const surreal = await createSurreal();
        const controller = new AbortController();

        const [value] = await surreal
            .query("RETURN 40 + 2")
            .signal(controller.signal)
            .collect<[number]>();

        expect(value).toBe(42);

        // Aborting afterwards has nothing to abort
        controller.abort();

        expect(await surreal.query("RETURN 1").collect()).toEqual([1]);
    });

    test("a write which had been sent before the abort is not undone", async () => {
        const surreal = await createSurreal();
        await surreal.query(/* surql */ `DEFINE TABLE person SCHEMALESS`);

        // The write is done at once, and the rest of the query takes a while
        const error = await caught(
            surreal
                .query(`CREATE person:written SET name = 'Tobie'; ${SLOW}`)
                .signal(AbortSignal.timeout(300))
                .collect(),
        );

        expect((error as Error).name).toBe("TimeoutError");

        // The caller stopped waiting, but not the server: the write is there. This is why an
        // aborted write has to be checked rather than assumed not to have happened.
        const [written] = await surreal
            .query("SELECT * FROM person:written")
            .collect<[{ name: string }[]]>();

        expect(written).toHaveLength(1);
        expect(written?.[0]?.name).toBe("Tobie");
    });
});

describe.if(SURREAL_PROTOCOL === "ws" || SURREAL_PROTOCOL === "http")("requestTimeout", () => {
    test("a connection default limits the wait for every query", async () => {
        // Defined over a connection of its own, as the limit would apply to defining it too
        await defineSlowFunction(await createSurreal());

        const { surreal, connect } = await createIdleSurreal();
        await connect({ requestTimeout: 200 });

        const { ms, value } = await timed(() => caught(surreal.query(SLOW).collect()));

        expect((value as Error).name).toBe("TimeoutError");
        expect(ms).toBeLessThan(PROMPT);

        // A builder is held to it too, as is the next query: nothing was left behind
        const builder = await caught(Promise.resolve(surreal.run("fn::slow")));

        expect((builder as Error).name).toBe("TimeoutError");
        expect(await surreal.query("RETURN 1").collect()).toEqual([1]);
    });

    test("queries which finish in time are unaffected", async () => {
        const { surreal, connect } = await createIdleSurreal();
        await connect({ requestTimeout: 5000 });

        expect(await surreal.query("RETURN 1").collect()).toEqual([1]);
    });

    test("a query can allow itself longer than the default", async () => {
        const { surreal, connect } = await createIdleSurreal();
        await connect({ requestTimeout: 300 });

        const slow = "SLEEP 800ms; RETURN 'done'";

        expect(((await caught(surreal.query(slow).collect())) as Error).name).toBe("TimeoutError");

        const [done] = await surreal.query(slow).requestTimeout(5000).collect<[string]>(1);
        expect(done).toBe("done");

        const [again] = await surreal.query(slow).requestTimeout(0).collect<[string]>(1);
        expect(again).toBe("done");
    });

    test("a query can be limited when the connection has no default", async () => {
        const surreal = await createSurreal();

        const { ms, value } = await timed(() =>
            caught(surreal.query(SLOW).requestTimeout(150).collect()),
        );

        expect((value as Error).name).toBe("TimeoutError");
        expect(ms).toBeLessThan(PROMPT);
    });

    test("it is told apart from the TIMEOUT clause which the server enforces", async () => {
        const surreal = await createSurreal();
        await surreal.query(/* surql */ `CREATE person:1; CREATE person:2; CREATE person:3;`);

        // The server gives up on this one, long before the client would
        const { ms, value } = await timed(() =>
            caught(
                surreal
                    .query("SELECT sleep(300ms) FROM person TIMEOUT 100ms")
                    .requestTimeout(PROMPT)
                    .collect(),
            ),
        );

        // An error the server reported, rather than the client's TimeoutError
        expect(value).toBeInstanceOf(ServerError);
        expect((value as Error).name).not.toBe("TimeoutError");
        expect((value as Error).message).toMatch(/exceeded the timeout/);
        expect(ms).toBeLessThan(PROMPT);

        // Servers before 3.0 do not say what kind of error it was, so it is a generic ServerError
        // there. From 3.0 it is the QueryError which says it timed out.
        if (is3x) expect(value).toBeInstanceOf(QueryError);
    });

    test("an invalid value is refused", async () => {
        const { connect } = await createIdleSurreal();

        expect(await caught(connect({ requestTimeout: -1 }))).toBeInstanceOf(Error);
        expect(await caught(connect({ requestTimeout: Number.NaN }))).toBeInstanceOf(Error);
    });
});

describe.if(SURREAL_PROTOCOL === "ws" || SURREAL_PROTOCOL === "http")("withSignal", () => {
    test("everything made through a scope is abandoned with its signal", async () => {
        const surreal = await createSurreal();
        await defineSlowFunction(surreal);

        const controller = new AbortController();
        const reason = new Error("the request went away");
        const scoped = surreal.withSignal(controller.signal);

        const queries = [
            caught(scoped.query(SLOW).collect()),
            caught(scoped.query(SLOW).responses()),
            caught(Promise.resolve(scoped.run("fn::slow"))),
        ];

        await Bun.sleep(100);
        controller.abort(reason);

        const { ms } = await timed(() => Promise.all(queries));
        const errors = await Promise.all(queries);

        expect(errors).toEqual([reason, reason, reason]);
        expect(ms).toBeLessThan(PROMPT);

        // The connection it was made from carries on, and so does a scope with a signal still alive
        expect(await surreal.query("RETURN 1").collect()).toEqual([1]);
        expect(await surreal.withSignal(new AbortController().signal).query("RETURN 2")).toEqual([
            2,
        ]);
    });

    test("a scope which has aborted sends nothing", async () => {
        const surreal = await createSurreal();
        await surreal.query(/* surql */ `DEFINE TABLE person SCHEMALESS`);

        const controller = new AbortController();
        const reason = new Error("the request went away");
        controller.abort(reason);

        const scoped = surreal.withSignal(controller.signal);

        expect(await caught(Promise.resolve(scoped.create(new Table("person")).content({})))).toBe(
            reason,
        );

        const [people] = await surreal.query("SELECT * FROM person").collect<[unknown[]]>();
        expect(people).toEqual([]);
    });

    test("the signal of one call is combined with the scope's", async () => {
        const surreal = await createSurreal();
        const scope = new AbortController();
        const scoped = surreal.withSignal(scope.signal);

        const error = (await caught(
            scoped.query(SLOW).signal(AbortSignal.timeout(100)).collect(),
        )) as Error;

        // The call gave up first, with its own reason, and the scope is untouched
        expect(error.name).toBe("TimeoutError");
        expect(scope.signal.aborted).toBe(false);
        expect(await scoped.query("RETURN 1")).toEqual([1]);
    });

    test("scoping works on a session of its own", async () => {
        const surreal = await createSurreal();

        // A fork inherits the namespace, database and authentication. Sessions are for 3.x over
        // WebSocket only, so use the default session otherwise.
        const session = surreal.isFeatureSupported(Features.Sessions)
            ? await surreal.forkSession()
            : surreal;

        const error = (await caught(
            session.withSignal(AbortSignal.timeout(100)).query(SLOW).collect(),
        )) as Error;

        expect(error.name).toBe("TimeoutError");
        expect(await session.query("RETURN 1").collect()).toEqual([1]);
    });
});

describe.if(is3x && SURREAL_PROTOCOL === "ws")("transactions and signals", () => {
    test("a query abandoned inside a scoped transaction leaves the connection usable", async () => {
        const surreal = await createSurreal();
        await surreal.query(/* surql */ `DEFINE TABLE person SCHEMALESS`);

        const controller = new AbortController();
        const scoped = surreal.withSignal(controller.signal);
        const txn = await scoped.beginTransaction();

        await txn.create(new RecordId("person", "inside")).content({ name: "Inside" });

        setTimeout(() => controller.abort(new Error("the request went away")), 100);

        const error = (await caught(txn.query(SLOW).collect())) as Error;

        expect(error.message).toBe("the request went away");

        // The transaction was never committed, and the connection is none the worse for it
        await txn.cancel();

        const [people] = await surreal.query("SELECT * FROM person").collect<[unknown[]]>();
        expect(people).toEqual([]);
        expect(await surreal.query("RETURN 1").collect()).toEqual([1]);
    });

    test("committing is not abandoned with the request", async () => {
        const surreal = await createSurreal();
        await surreal.query(/* surql */ `DEFINE TABLE person SCHEMALESS`);

        const controller = new AbortController();
        const txn = await surreal.withSignal(controller.signal).beginTransaction();

        await txn.create(new RecordId("person", "kept")).content({ name: "Kept" });

        controller.abort(new Error("the request went away"));

        // Queries are bound to the signal, and a commit is not: it is not left in doubt
        await txn.commit();

        const [people] = await surreal.query("SELECT * FROM person").collect<[unknown[]]>();
        expect(people).toHaveLength(1);
    });
});
