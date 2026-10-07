import { describe, expect, test } from "bun:test";
import { QueryError, ServerError, ThrownError, ValidationError } from "../../../sdk/src/errors";
import { Query } from "../../../sdk/src/query/query";
import type { RetryOptions } from "../../../sdk/src/types";
import { BoundQuery } from "../../../sdk/src/utils/bound-query";
import {
    abortedCommit,
    cancelled,
    conflict,
    connection,
    fail,
    notExecuted,
    ok,
    thrown,
} from "./__helpers__/scripted-connection";

type Scripts = Parameters<typeof connection>[0];

function query(scripts: Scripts, options?: Parameters<typeof connection>[1]) {
    const conn = connection(scripts, options);

    return {
        conn,
        query: new Query(conn, {
            query: new BoundQuery("RETURN 1"),
            transaction: undefined,
            session: undefined,
            json: false,
        }),
    };
}

const FAST: Partial<RetryOptions> = { retryDelay: 0, retryDelayMax: 0 };

describe("Query.collect() of a query which holds a transaction", () => {
    // BEGIN; CREATE a; THROW 'boom'; CREATE b; COMMIT;
    test("throws the error which made it fail, not the first one", async () => {
        const root = thrown();
        const { query: q } = query([
            [ok(), fail(notExecuted()), fail(root), fail(cancelled()), fail(abortedCommit())],
        ]);

        await expect(q.collect()).rejects.toBe(root);
    });

    // BEGIN; UPDATE a; UPDATE b; COMMIT; with a conflict on the commit
    test("throws a conflict which is reported by the COMMIT, after the rest", async () => {
        const root = conflict();
        const { query: q } = query([[ok(), fail(notExecuted()), fail(notExecuted()), fail(root)]]);

        await expect(q.collect()).rejects.toBe(root);
    });

    test("awaiting the query throws it as well", async () => {
        const root = conflict();
        const { query: q } = query([[ok(), fail(notExecuted()), fail(root)]]);

        await expect(Promise.resolve(q)).rejects.toBe(root);
    });

    test("throws the first error when there is nothing but consequences", async () => {
        const first = notExecuted();
        const { conn, query: q } = query([[ok(), fail(first), fail(cancelled())]]);

        await expect(q.collect()).rejects.toBe(first);

        // It had to read to the end to know
        expect(conn.pulled).toBe(3);
    });

    test("stops reading at the error which made it fail", async () => {
        const { conn, query: q } = query([
            [ok(), fail(notExecuted()), fail(thrown()), fail(cancelled()), fail(abortedCommit())],
        ]);

        await expect(q.collect()).rejects.toBeInstanceOf(ThrownError);

        expect(conn.pulled).toBe(3);
    });

    test("throws an error of a statement which was not asked for", async () => {
        const root = thrown();
        const { query: q } = query([[ok("a"), fail(notExecuted()), fail(root)]]);

        await expect(q.collect(0)).rejects.toBe(root);
    });

    test("collects the results of one which went through", async () => {
        const { query: q } = query([[ok(), ok("a"), ok("b"), ok()]]);

        expect(await q.collect()).toEqual([undefined, "a", "b", undefined]);
    });

    describe("retry", () => {
        test("replays a transaction which conflicts on its COMMIT", async () => {
            const { conn, query: q } = query([
                [ok(), fail(notExecuted()), fail(notExecuted()), fail(conflict())],
                [ok(), ok("a"), ok("b"), ok()],
            ]);

            expect(await q.retry(FAST).collect()).toEqual([undefined, "a", "b", undefined]);
            expect(conn.sent).toHaveLength(2);
        });

        test("replays it for as long as it conflicts, then throws the conflict", async () => {
            const root = conflict();
            const { conn, query: q } = query([[ok(), fail(notExecuted()), fail(root)]]);

            await expect(q.retry({ ...FAST, attempts: 2 }).collect()).rejects.toBe(root);

            // The first attempt and two retries
            expect(conn.sent).toHaveLength(3);
        });

        test("asks the predicate about the error which made it fail", async () => {
            const seen: unknown[] = [];
            const root = thrown("custom conflict");
            const { query: q } = query([
                [ok(), fail(notExecuted()), fail(root), fail(abortedCommit())],
            ]);

            await expect(
                q
                    .retry({
                        ...FAST,
                        attempts: 1,
                        retryable: (error) => {
                            seen.push(error);
                            return true;
                        },
                    })
                    .collect(),
            ).rejects.toBe(root);

            expect(seen).toEqual([root, root]);
        });

        test("does not replay a failure which is not a conflict", async () => {
            const { conn, query: q } = query([[ok(), fail(thrown()), fail(abortedCommit())]]);

            await expect(q.retry(FAST).collect()).rejects.toBeInstanceOf(ThrownError);
            expect(conn.sent).toHaveLength(1);
        });

        test("uses the retry of the connection", async () => {
            const { conn, query: q } = query(
                [
                    [ok(), fail(notExecuted()), fail(conflict())],
                    [ok(), ok("a"), ok()],
                ],
                { retry: { enabled: true } },
            );

            expect(await q).toEqual([undefined, "a", undefined]);
            expect(conn.sent).toHaveLength(2);
        });
    });

    describe("responses() and stream() are unchanged", () => {
        test("responses() reports every error as the server sent it", async () => {
            const root = conflict();
            const first = notExecuted();
            const { query: q } = query([[ok(), fail(first), fail(root)]]);

            const responses = await q.responses();

            expect(responses.map((r) => r.success)).toEqual([true, false, false]);
            expect(responses[1].success || responses[1].error).toBe(first);
            expect(responses[2].success || responses[2].error).toBe(root);
        });

        test("stream() yields an error frame for every error, in order", async () => {
            const first = notExecuted();
            const root = conflict();
            const { query: q } = query([[ok(), fail(first), fail(root)]]);

            const errors: unknown[] = [];

            for await (const frame of q.stream()) {
                if (frame.isError()) errors.push(frame.error);
            }

            expect(errors).toEqual([first, root]);
        });
    });
});

describe("Query.collect() of a query which does not hold a transaction", () => {
    test("throws the first error, and stops reading there, as it always has", async () => {
        const first = thrown("first");
        const { conn, query: q } = query([[ok(1), fail(first), ok(3), fail(thrown("second"))]]);

        await expect(q.collect()).rejects.toBe(first);

        expect(conn.pulled).toBe(2);
    });

    test("throws a failure of the first statement", async () => {
        const first = new ValidationError({ kind: "Validation", message: "nope" });
        const { query: q } = query([[fail(first), ok(2)]]);

        await expect(q.collect()).rejects.toBe(first);
    });

    test("throws an error of a statement which was not asked for", async () => {
        const first = thrown("first");
        const { query: q } = query([[ok(1), fail(first), ok(3)]]);

        await expect(q.collect(0, 2)).rejects.toBe(first);
    });

    test("throws an error of the request as it is", async () => {
        const error = new ValidationError({ kind: "Validation", message: "Parse error" });
        const { query: q } = query([error]);

        await expect(q.collect()).rejects.toBe(error);
    });

    test("collects the results of one which went through", async () => {
        const { query: q } = query([[ok(1), ok(2), ok(3)]]);

        expect(await q.collect()).toEqual([1, 2, 3]);
        expect(await query([[ok(1), ok(2), ok(3)]]).query.collect(0, 2)).toEqual([1, 3]);
    });

    test("does not retry a failure which is not retryable, as before", async () => {
        const first = thrown("first");
        const { conn, query: q } = query([[ok(1), fail(first)]]);

        await expect(q.retry(FAST).collect()).rejects.toBe(first);
        expect(conn.sent).toHaveLength(1);
    });

    test("retries a conflict, as before", async () => {
        const { conn, query: q } = query([[fail(conflict())], [ok(1)]]);

        expect(await q.retry(FAST).collect()).toEqual([1]);
        expect(conn.sent).toHaveLength(2);
    });

    test("an error is still an error of its kind", async () => {
        const { query: q } = query([[ok(), fail(notExecuted()), fail(thrown())]]);

        const error = await q.collect().catch((e: unknown) => e);

        expect(error).toBeInstanceOf(ServerError);
        expect(error).not.toBeInstanceOf(QueryError);
    });
});
