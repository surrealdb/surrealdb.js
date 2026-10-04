import { describe, expect, test } from "bun:test";
import { QueryError, RecordId, ServerError, ThrownError } from "surrealdb";
import { createIdleSurreal, createSurreal, requestVersion, SURREAL_PROTOCOL } from "./__helpers__";

const { is3x } = await requestVersion();

// These tests simulate conflicts with `THROW`, which surfaces a generic server error
// rather than the structured `TransactionConflict` detail that the default predicate
// matches. They therefore opt into a message-based `retryable` predicate — the same
// custom-callback pattern documented for targeting servers older than 3.1.0.
const messageRetryable = (error: unknown): boolean => {
    if (!(error instanceof ServerError)) return false;
    const message = error.message.toLowerCase();
    return message.includes("conflict") || message.includes("can be retried");
};

// Fast retry options so tests don't spend real time backing off.
const FAST_RETRY = {
    enabled: true,
    retryDelay: 1,
    retryDelayMax: 5,
    retryable: messageRetryable,
} as const;

describe.if(is3x && (SURREAL_PROTOCOL === "ws" || SURREAL_PROTOCOL === "mem"))(
    "retry",
    async () => {
        test("query().retry() replays until the conflict clears", async () => {
            const surreal = await createSurreal();
            await surreal.query(/* surql */ `CREATE counter:c SET n = 0`);

            // Each send increments the (separately committed) counter, then throws a conflict
            // error while the count is still low. The query is re-sent until it stops throwing.
            // Collect only the final RETURN statement (index 2).
            const [n] = await surreal
                .query(/* surql */ `
                    UPDATE counter:c SET n += 1;
                    IF (SELECT VALUE n FROM ONLY counter:c) <= 2 {
                        THROW "read or write conflict, can be retried"
                    };
                    RETURN (SELECT VALUE n FROM ONLY counter:c);
                `)
                .retry(FAST_RETRY)
                .collect<[number]>(2);

            // n === number of sends: throws at 1 and 2, succeeds at 3.
            expect(n).toBe(3);
        });

        test("query without .retry() surfaces the conflict immediately", async () => {
            const surreal = await createSurreal();
            await surreal.query(/* surql */ `CREATE counter:c SET n = 0`);

            const promise = surreal
                .query(/* surql */ `THROW "read or write conflict, can be retried"`)
                .collect();

            expect(promise).rejects.toBeInstanceOf(ServerError);
        });
    },
);

// A hand written BEGIN ... COMMIT, which works over every protocol. When it fails, the server
// reports an error for each of its statements, and a conflict on the COMMIT is the last of them,
// after a "not executed" for every statement before it.
describe.if(is3x)("retry of a query which holds a transaction", async () => {
    // Each updates the same record, and stays open long enough for the other to as well
    const increment = /* surql */ `
        BEGIN;
        UPDATE counter:c SET n += 1;
        SLEEP 300ms;
        COMMIT;
    `;

    async function connections() {
        const [first, second] = await Promise.all([createSurreal(), createSurreal()]);
        await first.query(/* surql */ `CREATE counter:c SET n = 0`);

        return { first, second };
    }

    const counter = async (surreal: Awaited<ReturnType<typeof createSurreal>>) =>
        surreal.select<{ n: number }>(new RecordId("counter", "c"));

    test("without retry, the conflict is what collect() throws", async () => {
        const { first, second } = await connections();

        const settled = await Promise.allSettled([
            first.query(increment).collect(),
            second.query(increment).collect(),
        ]);

        const losers = settled.filter((s) => s.status === "rejected");

        expect(losers).toHaveLength(1);

        // Not the "not executed" error of the UPDATE, which the server reports first
        const reason = (losers[0] as PromiseRejectedResult).reason;

        expect(reason).toBeInstanceOf(QueryError);
        expect((reason as QueryError).isTransactionConflict).toBeTrue();
        expect((reason as QueryError).isNotExecuted).toBeFalse();
    });

    test("with retry, the loser is replayed and both go through", async () => {
        const { first, second } = await connections();
        const retry = { retryDelay: 1, retryDelayMax: 10, attempts: 10 };

        await Promise.all([
            first.query(increment).retry(retry).collect(),
            second.query(increment).retry(retry).collect(),
        ]);

        expect((await counter(first))?.n).toBe(2);
    });

    test("with the retry of the connection, awaiting the query replays it too", async () => {
        const [first, second] = await Promise.all([createIdleSurreal(), createIdleSurreal()]);
        const retry = { enabled: true, retryDelay: 1, retryDelayMax: 10, attempts: 10 };

        await Promise.all([first.connect({ retry }), second.connect({ retry })]);
        await first.surreal.query(/* surql */ `CREATE counter:c SET n = 0`);

        await Promise.all([first.surreal.query(increment), second.surreal.query(increment)]);

        expect((await counter(first.surreal))?.n).toBe(2);
    });

    test("with retry, a query inside of a list is replayed as well", async () => {
        const { first, second } = await connections();
        const retry = { retryDelay: 1, retryDelayMax: 10, attempts: 10 };

        await Promise.all([
            first.query([increment]).retry(retry).collect(),
            second.query([increment]).retry(retry).collect(),
        ]);

        expect((await counter(first))?.n).toBe(2);
    });

    test("a failure which is not a conflict is thrown as it is, without a retry", async () => {
        const surreal = await createSurreal();
        let asked = 0;

        const promise = surreal
            .query(/* surql */ `BEGIN; CREATE counter:x; THROW 'boom'; COMMIT;`)
            .retry({
                retryDelay: 1,
                retryDelayMax: 5,
                retryable: (error) => {
                    asked++;
                    return error instanceof QueryError && error.isTransactionConflict;
                },
            })
            .collect();

        await expect(promise).rejects.toBeInstanceOf(ThrownError);
        await expect(promise).rejects.toThrow("boom");

        // Asked once, about the failure itself and not about what it caused
        expect(asked).toBe(1);
    });
});

describe("collect() of a query which does not hold a transaction", async () => {
    test("throws the first error, as it always has", async () => {
        const surreal = await createSurreal();

        const promise = surreal
            .query(["RETURN 1", "THROW 'first'", "RETURN 3", "THROW 'second'"])
            .collect();

        await expect(promise).rejects.toBeInstanceOf(ServerError);
        await expect(promise).rejects.toThrow("first");
    });
});
