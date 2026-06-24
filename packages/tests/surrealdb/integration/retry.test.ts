import { describe, expect, test } from "bun:test";
import { ServerError } from "surrealdb";
import { createSurreal, requestVersion, SURREAL_PROTOCOL } from "./__helpers__";

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
