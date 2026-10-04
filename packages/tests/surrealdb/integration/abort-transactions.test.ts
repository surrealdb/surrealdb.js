import { describe, expect, test } from "bun:test";
import { RecordId, ServerError, surql } from "surrealdb";
import { createIdleSurreal, createSurreal, SURREAL_PROTOCOL } from "./__helpers__";

// A statement far slower than any of these tests is willing to wait
const SLOW = "SLEEP 5s";

// How long something abandoned after a fraction of a second is allowed to take to report it
const PROMPT = 2000;

async function caught(promise: Promise<unknown>): Promise<unknown> {
    try {
        await promise;
    } catch (error) {
        return error;
    }

    throw new Error("Expected the promise to reject");
}

async function timed<T>(run: () => Promise<T>): Promise<{ ms: number; value: T }> {
    const started = performance.now();
    const value = await run();

    return { ms: performance.now() - started, value };
}

// A conflict is simulated with THROW, which is not reported as the structured conflict that
// servers from 3.1 send, so what is retryable is told by the message
const messageRetryable = (error: unknown): boolean =>
    error instanceof ServerError && error.message.toLowerCase().includes("can be retried");

// Stateless: a transaction([...]) is a single request, so it works over HTTP as well as WebSocket
describe.if(SURREAL_PROTOCOL === "ws" || SURREAL_PROTOCOL === "http")(
    "query([...]) and signals",
    () => {
        test("a list of queries is abandoned promptly, and the connection answers the next", async () => {
            const surreal = await createSurreal();

            const { ms, value } = await timed(() =>
                caught(
                    surreal
                        .query(["RETURN 1", SLOW, surql`RETURN ${2}`])
                        .signal(AbortSignal.timeout(150))
                        .collect(),
                ),
            );

            expect((value as Error).name).toBe("TimeoutError");
            expect(ms).toBeLessThan(PROMPT);
            expect(await surreal.query(["RETURN 1", "RETURN 2"]).collect()).toEqual([1, 2]);
        });

        test("a request scope abandons it with its signal", async () => {
            const surreal = await createSurreal();
            const controller = new AbortController();
            const reason = new Error("the request went away");
            const scoped = surreal.withSignal(controller.signal);

            const running = caught(scoped.query([SLOW, "RETURN 1"]).collect());

            await Bun.sleep(100);
            controller.abort(reason);

            expect(await running).toBe(reason);
            expect(await surreal.query(["RETURN 1"]).collect()).toEqual([1]);
        });

        test("a signal which has aborted already means nothing is run", async () => {
            const surreal = await createSurreal();
            await surreal.query("DEFINE TABLE person SCHEMALESS");
            const reason = new Error("never started");
            const controller = new AbortController();
            controller.abort(reason);

            const error = await caught(
                surreal
                    .query(["CREATE person:one", "CREATE person:two"])
                    .signal(controller.signal)
                    .collect(),
            );

            expect(error).toBe(reason);
            expect(await surreal.select(new RecordId("person", "one"))).toBeUndefined();
        });
    },
);

describe.if(SURREAL_PROTOCOL === "ws" || SURREAL_PROTOCOL === "http")(
    "transaction() and signals",
    () => {
        test("a transaction is abandoned promptly with the reason of the signal", async () => {
            const surreal = await createSurreal();
            const controller = new AbortController();
            const reason = new Error("the client went away");

            setTimeout(() => controller.abort(reason), 100);

            const { ms, value } = await timed(() =>
                caught(surreal.transaction([SLOW], { signal: controller.signal })),
            );

            expect(value).toBe(reason);
            expect(ms).toBeLessThan(PROMPT);
            expect(await surreal.query("RETURN 1").collect()).toEqual([1]);
        });

        test("a timeout is a TimeoutError, from a signal and from requestTimeout alike", async () => {
            const surreal = await createSurreal();

            const fromSignal = await caught(
                surreal.transaction([SLOW], { signal: AbortSignal.timeout(150) }),
            );
            const fromOption = await caught(surreal.transaction([SLOW], { requestTimeout: 150 }));

            expect((fromSignal as Error).name).toBe("TimeoutError");
            expect((fromOption as Error).name).toBe("TimeoutError");
        });

        test("the requestTimeout of the connection applies to a transaction, and can be overridden", async () => {
            const { surreal, connect } = await createIdleSurreal();
            await connect({ requestTimeout: 200 });

            const { ms, value } = await timed(() => caught(surreal.transaction([SLOW])));

            expect((value as Error).name).toBe("TimeoutError");
            expect(ms).toBeLessThan(PROMPT);

            // Allowed longer than the default, which a signal could not do
            const slower = "SLEEP 600ms; RETURN 'done'";
            expect(await caught(surreal.transaction([slower]))).toBeInstanceOf(Error);
            expect(await surreal.transaction([slower], { requestTimeout: 0 })).toBeDefined();
        });

        test("a signal which has aborted already means nothing is run", async () => {
            const surreal = await createSurreal();
            await surreal.query("DEFINE TABLE person SCHEMALESS");
            const reason = new Error("never started");
            const controller = new AbortController();
            controller.abort(reason);

            const error = await caught(
                surreal.transaction(["CREATE person:one", "CREATE person:two"], {
                    signal: controller.signal,
                }),
            );

            expect(error).toBe(reason);
            expect(await surreal.select(new RecordId("person", "one"))).toBeUndefined();
        });

        test("a request scope abandons it, and its retries, with its signal", async () => {
            const surreal = await createSurreal();
            const controller = new AbortController();
            const reason = new Error("the request went away");
            const scoped = surreal.withSignal(controller.signal);

            const running = caught(scoped.transaction([SLOW]));
            await Bun.sleep(100);
            controller.abort(reason);

            expect(await running).toBe(reason);
            expect(await surreal.query("RETURN 1").collect()).toEqual([1]);
        });

        test("aborting while waiting to retry stops the retrying", async () => {
            const surreal = await createSurreal();
            const controller = new AbortController();
            const reason = new Error("the client went away");

            setTimeout(() => controller.abort(reason), 200);

            // Fails every time, in a way which is worth retrying, with five seconds between attempts
            const { ms, value } = await timed(() =>
                caught(
                    surreal.transaction(["THROW 'read or write conflict, can be retried'"], {
                        retry: {
                            enabled: true,
                            attempts: -1,
                            retryDelay: 5000,
                            retryDelayMax: 5000,
                            retryable: messageRetryable,
                        },
                        signal: controller.signal,
                    }),
                ),
            );

            expect(value).toBe(reason);
            expect(ms).toBeLessThan(PROMPT);
        });

        test("an error which made a transaction fail is still the one thrown, under a signal", async () => {
            const surreal = await createSurreal();
            const controller = new AbortController();

            const error = await caught(
                surreal.transaction(["'a'", "THROW 'the real cause'"], {
                    signal: controller.signal,
                }),
            );

            expect(error).toBeInstanceOf(ServerError);
            expect((error as Error).message).toContain("the real cause");
        });

        test("a transaction which is abandoned is still atomic: both of its records exist, or neither", async () => {
            const surreal = await createSurreal();
            await surreal.query("DEFINE TABLE person SCHEMALESS");

            // The two records are written before the wait, and committed after it. Whether the server
            // carries on to commit, which depends on the protocol, is not for the client to tell.
            await caught(
                surreal.transaction(["CREATE person:one", "CREATE person:two", "SLEEP 600ms"], {
                    signal: AbortSignal.timeout(150),
                }),
            );

            await Bun.sleep(1200);

            const one = await surreal.select(new RecordId("person", "one"));
            const two = await surreal.select(new RecordId("person", "two"));

            expect(one === undefined).toBe(two === undefined);
        });
    },
);
