import { describe, expect, test } from "bun:test";
import { ServerError } from "surrealdb";
import { createSurreal, requestVersion, SURREAL_PROTOCOL } from "./__helpers__";

const { is3x } = await requestVersion();

// Fast retry options so tests don't spend real time backing off.
const FAST_RETRY = { enabled: true, retryDelay: 1, retryDelayMax: 5 } as const;

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

        test("transaction() retries the closure until it commits", async () => {
            const surreal = await createSurreal();
            await surreal.query(/* surql */ `CREATE thing:t SET ok = false`);

            let attempts = 0;

            const result = await surreal.transaction(async (tx) => {
                attempts++;
                await tx.query(/* surql */ `UPDATE thing:t SET ok = true`);

                if (attempts <= 2) {
                    await tx.query(/* surql */ `THROW "read or write conflict, can be retried"`);
                }

                return attempts;
            }, FAST_RETRY);

            expect(result).toBe(3);
            expect(attempts).toBe(3);

            // The successful attempt committed.
            const ok = await surreal.query<[boolean]>(/* surql */ `RETURN thing:t.ok`).collect();
            expect(ok[0]).toBe(true);
        });

        test("transaction() without retry runs once and surfaces the conflict", async () => {
            const surreal = await createSurreal();

            let attempts = 0;

            const promise = surreal.transaction(async (tx) => {
                attempts++;
                await tx.query(/* surql */ `THROW "read or write conflict, can be retried"`);
            });

            await expect(promise).rejects.toBeInstanceOf(ServerError);
            expect(attempts).toBe(1);
        });

        test("transaction() does not retry non-conflict errors", async () => {
            const surreal = await createSurreal();

            let attempts = 0;

            const promise = surreal.transaction(async (tx) => {
                attempts++;
                await tx.query(/* surql */ `THROW "some unrelated failure"`);
            }, FAST_RETRY);

            await expect(promise).rejects.toBeInstanceOf(ServerError);
            expect(attempts).toBe(1);
        });

        test("transaction() rethrows after exhausting attempts", async () => {
            const surreal = await createSurreal();

            let attempts = 0;

            const promise = surreal.transaction(
                async (tx) => {
                    attempts++;
                    await tx.query(/* surql */ `THROW "read or write conflict, can be retried"`);
                },
                { ...FAST_RETRY, attempts: 2 },
            );

            await expect(promise).rejects.toBeInstanceOf(ServerError);
            // initial attempt + 2 retries
            expect(attempts).toBe(3);
        });
    },
);
