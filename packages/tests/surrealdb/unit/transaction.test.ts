import { describe, expect, test } from "bun:test";
import { Uuid } from "@surrealdb/sqon";
import { Surreal } from "../../../sdk/src/api/surreal";
import { SurrealTransaction } from "../../../sdk/src/api/transaction";
import type { ConnectionController } from "../../../sdk/src/controller";
import {
    ExpressionError,
    InternalError,
    QueryError,
    type ServerError,
    ThrownError,
    ValidationError,
} from "../../../sdk/src/errors";
import { DEFAULT_RETRY_OPTIONS } from "../../../sdk/src/internal/retry";
import {
    executeTransaction,
    findRootCause,
    isSecondaryError,
    unwrapResults,
} from "../../../sdk/src/internal/transaction";
import type {
    QueryChunk,
    QueryResponse,
    RetryOptions,
    TransactionOptions,
} from "../../../sdk/src/types";
import { BoundQuery } from "../../../sdk/src/utils/bound-query";
import { surql } from "../../../sdk/src/utils/tagged-template";

// =========================================================== //
//  The errors a real server reports (SurrealDB 3.2.3)          //
// =========================================================== //

const notExecuted = () =>
    new QueryError({
        kind: "Query",
        message: "The query was not executed due to a failed transaction",
        details: { kind: "NotExecuted" },
    });

const cancelled = () =>
    new QueryError({
        kind: "Query",
        message: "The query was not executed due to a cancelled transaction",
        details: { kind: "Cancelled" },
    });

const abortedCommit = () =>
    new QueryError({
        kind: "Query",
        message: "Cannot COMMIT: the transaction was aborted due to a prior error",
        details: { kind: "NotExecuted" },
    });

const thrown = (message = "boom") =>
    new ThrownError({ kind: "Thrown", message: `An error occurred: ${message}` });

const conflict = () =>
    new QueryError({
        kind: "Query",
        message:
            "Cannot COMMIT: Transaction conflict: Write conflict. This transaction can be retried",
        details: { kind: "TransactionConflict" },
    });

// =========================================================== //
//  Scripted responses                                          //
// =========================================================== //

type Slot = { ok: unknown } | { error: ServerError };

const ok = (value?: unknown): Slot => ({ ok: value });
const fail = (error: ServerError): Slot => ({ error });

function toResponses(slots: Slot[]): QueryResponse[] {
    return slots.map((slot) =>
        "error" in slot
            ? { success: false, error: slot.error }
            : { success: true, result: slot.ok, type: "other" },
    );
}

function toChunks(slots: Slot[]): QueryChunk<unknown>[] {
    return slots.map((slot, index) => ({
        query: index,
        batch: 0,
        kind: "single",
        ...("error" in slot
            ? { error: slot.error }
            : { result: [slot.ok], type: "other" as const }),
    }));
}

/**
 * A connection which answers the n-th request with the n-th script, the way the server
 * answers a `BEGIN ... COMMIT` query: a slot for the BEGIN, one for each statement, and a
 * slot for the COMMIT.
 */
function connection(
    scripts: (Slot[] | Error)[],
    options: { version?: string | null; retry?: Partial<RetryOptions> } = {},
) {
    const sent: { query: BoundQuery; session: unknown; transaction: unknown }[] = [];

    const fake = {
        sent,
        ready: async () => {},
        retry: { ...DEFAULT_RETRY_OPTIONS, retryDelay: 0, retryDelayMax: 0, ...options.retry },
        serverVersion:
            options.version === null ? undefined : (options.version ?? "surrealdb-3.2.3"),
        query: (query: BoundQuery, session: unknown, transaction: unknown) => {
            const script = scripts[Math.min(sent.length, scripts.length - 1)];
            sent.push({ query, session, transaction });

            return (async function* () {
                if (script instanceof Error) throw script;
                yield* toChunks(script);
            })();
        },
    };

    return fake as typeof fake & ConnectionController;
}

const FAST: TransactionOptions = { retry: { enabled: true, retryDelay: 0, retryDelayMax: 0 } };

describe("isSecondaryError", () => {
    test("the errors reported for the statements around a failure are secondary", () => {
        expect(isSecondaryError(notExecuted())).toBe(true);
        expect(isSecondaryError(cancelled())).toBe(true);
        expect(isSecondaryError(abortedCommit())).toBe(true);
    });

    test("a failure itself is not secondary", () => {
        expect(isSecondaryError(thrown())).toBe(false);
        expect(isSecondaryError(conflict())).toBe(false);
        expect(
            isSecondaryError(new InternalError({ kind: "Internal", message: "index contains x" })),
        ).toBe(false);
        expect(
            isSecondaryError(
                new QueryError({
                    kind: "Query",
                    message: "timed out",
                    details: { kind: "TimedOut", details: { duration: { secs: 1, nanos: 0 } } },
                }),
            ),
        ).toBe(false);
    });

    test("recognizes the errors of servers which do not send structured errors", () => {
        // Parsed with the `Internal` kind and no details, as there is nothing to go by
        const legacy = (message: string) => new InternalError({ kind: "Internal", message });

        expect(
            isSecondaryError(legacy("The query was not executed due to a failed transaction")),
        ).toBe(true);
        expect(
            isSecondaryError(legacy("The query was not executed due to a cancelled transaction")),
        ).toBe(true);
        expect(
            isSecondaryError(
                legacy("The query was not executed due to a failed transaction. Some detail"),
            ),
        ).toBe(true);
        expect(isSecondaryError(legacy("An error occurred: boom"))).toBe(false);
    });

    test("does not read the message of an error which is structured", () => {
        const lookalike = new ThrownError({
            kind: "Thrown",
            message: "The query was not executed due to a failed transaction",
            details: { kind: "Something" } as never,
        });

        expect(isSecondaryError(lookalike)).toBe(false);
    });
});

describe("findRootCause", () => {
    test("finds nothing when nothing failed", () => {
        expect(findRootCause(toResponses([ok(), ok(1), ok()]))).toBeUndefined();
        expect(findRootCause([])).toBeUndefined();
    });

    // BEGIN; CREATE a; THROW 'boom'; CREATE b; COMMIT;
    test("is not the first error: the statements before the failure are rewritten to errors", () => {
        const root = thrown();
        const responses = toResponses([
            ok(), // BEGIN
            fail(notExecuted()), // CREATE a
            fail(root), // THROW
            fail(cancelled()), // CREATE b
            fail(abortedCommit()), // COMMIT
        ]);

        expect(findRootCause(responses)).toBe(root);
    });

    // BEGIN; UPDATE c; UPDATE d; COMMIT; with a conflict on the commit
    test("finds a failure to commit, which is the last response", () => {
        const root = conflict();
        const responses = toResponses([ok(), fail(notExecuted()), fail(notExecuted()), fail(root)]);

        expect(findRootCause(responses)).toBe(root);
    });

    test("finds a failure in the first statement", () => {
        const root = thrown();

        expect(
            findRootCause(
                toResponses([ok(), fail(root), fail(cancelled()), fail(abortedCommit())]),
            ),
        ).toBe(root);
    });

    test("finds a failure in the last statement", () => {
        const root = thrown();

        expect(
            findRootCause(
                toResponses([ok(), fail(notExecuted()), fail(notExecuted()), fail(root), ok()]),
            ),
        ).toBe(root);
    });

    test("falls back to the first error when every error is secondary", () => {
        const first = notExecuted();

        expect(findRootCause(toResponses([ok(), fail(first), fail(cancelled())]))).toBe(first);
    });

    test("finds the failure among errors from a server without structured errors", () => {
        const secondary = new InternalError({
            kind: "Internal",
            message: "The query was not executed due to a failed transaction",
        });
        const root = new InternalError({ kind: "Internal", message: "An error occurred: boom" });

        expect(findRootCause(toResponses([ok(), fail(secondary), fail(root)]))).toBe(root);
    });

    test("skips responses which are missing", () => {
        const root = thrown();
        const responses = toResponses([ok(), fail(notExecuted()), fail(root)]);
        delete responses[1];

        expect(findRootCause(responses)).toBe(root);
    });
});

describe("unwrapResults", () => {
    test("leaves out the results of BEGIN and COMMIT", () => {
        expect(
            unwrapResults(toResponses([ok(), ok("a"), ok("b"), ok()]), "surrealdb-3.2.3"),
        ).toEqual(["a", "b"]);
    });

    test("returns nothing for a transaction of no statements", () => {
        expect(unwrapResults(toResponses([ok(), ok()]), "surrealdb-3.2.3")).toEqual([]);
    });

    test("keeps every result from a server which does not report BEGIN and COMMIT", () => {
        expect(unwrapResults(toResponses([ok("a"), ok("b")]), "surrealdb-2.4.0")).toEqual([
            "a",
            "b",
        ]);
        expect(unwrapResults(toResponses([ok("a")]), "2.1.0")).toEqual(["a"]);
        expect(unwrapResults([], "2.1.0")).toEqual([]);
    });

    test("assumes a recent server when the version is not known", () => {
        expect(unwrapResults(toResponses([ok(), ok("a"), ok()]), undefined)).toEqual(["a"]);
    });

    test("reports the version at which the shape changes", () => {
        const three = toResponses([ok(), ok("a"), ok()]);

        expect(unwrapResults(three, "surrealdb-3.0.0")).toEqual(["a"]);
        expect(unwrapResults(three, "3.0.0")).toEqual(["a"]);
        expect(unwrapResults(three, "surrealdb-3.0.0-beta.1")).toEqual(["a"]);
        expect(unwrapResults(toResponses([ok("a")]), "surrealdb-2.9.9")).toEqual(["a"]);
    });

    test("keeps the value of each result as is", () => {
        const value = { nested: [1, 2, 3] };

        expect(
            unwrapResults(toResponses([ok(), ok(value), ok(undefined), ok(null), ok()]), "3.0.0"),
        ).toEqual([value, undefined, null]);
    });

    test("refuses a transaction too short to have been wrapped", () => {
        expect(() => unwrapResults(toResponses([ok()]), "3.2.3")).toThrow(/reported 1 results/);
        expect(() => unwrapResults([], "3.2.3")).toThrow(/reported 0 results/);
    });

    test("refuses a result which is missing or failed", () => {
        expect(() => unwrapResults(toResponses([ok(), fail(thrown()), ok()]), "3.2.3")).toThrow(
            "Statement 0 of the transaction did not report a result",
        );
    });
});

describe("executeTransaction", () => {
    test("sends the queries in a single BEGIN ... COMMIT request", async () => {
        const conn = connection([[ok(), ok("a"), ok("b"), ok()]]);
        const results = await executeTransaction(conn, undefined, ["'a'", "'b'"]);

        expect(results).toEqual(["a", "b"]);
        expect(conn.sent).toHaveLength(1);
        expect(conn.sent[0].query.query).toBe("BEGIN;\n'a'\n;\n'b'\n;\nCOMMIT;");
    });

    test("is not run inside an interactive transaction", async () => {
        const conn = connection([[ok(), ok(1), ok()]]);
        await executeTransaction(conn, undefined, ["RETURN 1"]);

        expect(conn.sent[0].transaction).toBeUndefined();
    });

    test("runs in the session it was started on", async () => {
        const session = new Uuid("92b84bde-39c8-4b4b-92f7-626096d6c4d9");
        const conn = connection([[ok(), ok(1), ok()]]);
        await executeTransaction(conn, session, ["RETURN 1"]);

        expect(conn.sent[0].session).toBe(session);
    });

    test("sends the bindings of every query together", async () => {
        const conn = connection([[ok(), ok(), ok(), ok()]]);

        await executeTransaction(conn, undefined, [
            surql`CREATE a SET n = ${1}`,
            new BoundQuery("CREATE b SET n = $n", { n: 2 }),
        ]);

        const { query, bindings } = conn.sent[0].query;

        expect(Object.values(bindings).sort()).toEqual([1, 2]);
        expect(query).toContain("CREATE b SET n = $n");
    });

    test("returns one result per statement, whatever the inputs are", async () => {
        // The second input holds two statements
        const conn = connection([[ok(), ok("a"), ok("b"), ok("c"), ok()]]);

        expect(await executeTransaction(conn, undefined, ["'a'", "'b'; 'c'"])).toEqual([
            "a",
            "b",
            "c",
        ]);
    });

    test("returns every result from a server which does not report BEGIN and COMMIT", async () => {
        const conn = connection([[ok("a"), ok("b")]], { version: "surrealdb-2.4.0" });

        expect(await executeTransaction(conn, undefined, ["'a'", "'b'"])).toEqual(["a", "b"]);
    });

    test("with no queries, sends nothing", async () => {
        const conn = connection([[ok(), ok()]]);

        expect(await executeTransaction(conn, undefined, [])).toEqual([]);
        expect(conn.sent).toHaveLength(0);
    });

    describe("rejecting queries", () => {
        test("rejects transaction statements without sending anything", async () => {
            const conn = connection([[ok(), ok(), ok()]]);

            await expect(executeTransaction(conn, undefined, ["COMMIT"])).rejects.toThrow(
                ExpressionError,
            );
            expect(conn.sent).toHaveLength(0);
        });

        test("rejects a RETURN which is followed by another statement, without sending anything", async () => {
            const conn = connection([[ok(), ok(), ok()]]);

            await expect(
                executeTransaction(conn, undefined, ["RETURN 1", "CREATE a"]),
            ).rejects.toThrow(/RETURN statement which is followed/);
            expect(conn.sent).toHaveLength(0);
        });

        test("rejects an invalid input, naming it", async () => {
            const conn = connection([[ok(), ok(), ok()]]);

            await expect(
                executeTransaction(conn, undefined, ["RETURN 1", 5 as never]),
            ).rejects.toThrow("queries[1] is not a query");
        });

        test("rejects a binding conflict, naming both inputs", async () => {
            const conn = connection([[ok(), ok(), ok(), ok()]]);

            await expect(
                executeTransaction(conn, undefined, [
                    new BoundQuery("$x", { x: 1 }),
                    new BoundQuery("$x", { x: 2 }),
                ]),
            ).rejects.toThrow(/'\$x' is bound by both queries\[0\] and queries\[1\]/);
            expect(conn.sent).toHaveLength(0);
        });
    });

    describe("failures", () => {
        test("throws the root cause, not the first error", async () => {
            const root = thrown();
            const conn = connection([
                [ok(), fail(notExecuted()), fail(root), fail(cancelled()), fail(abortedCommit())],
            ]);

            await expect(
                executeTransaction(conn, undefined, ["CREATE a", "THROW 'boom'", "CREATE b"]),
            ).rejects.toBe(root);
        });

        test("throws a conflict on commit, which comes last", async () => {
            const root = conflict();
            const conn = connection([[ok(), fail(notExecuted()), fail(notExecuted()), fail(root)]]);

            await expect(
                executeTransaction(conn, undefined, ["UPDATE a", "UPDATE b"]),
            ).rejects.toBe(root);
        });

        test("throws an error of the request as it is", async () => {
            const error = new ValidationError({ kind: "Validation", message: "Parse error" });
            const conn = connection([error]);

            await expect(executeTransaction(conn, undefined, ["RETURN 1"])).rejects.toBe(error);
        });

        test("does not return results for a transaction which failed", async () => {
            const conn = connection([[ok(), ok("a"), fail(thrown()), fail(abortedCommit())]]);

            await expect(
                executeTransaction(conn, undefined, ["'a'", "THROW 'boom'"]),
            ).rejects.toThrow("boom");
        });
    });

    describe("retry", () => {
        test("does not retry by default", async () => {
            const conn = connection([[ok(), fail(notExecuted()), fail(conflict())]]);

            await expect(executeTransaction(conn, undefined, ["UPDATE a"])).rejects.toThrow(
                "conflict",
            );
            expect(conn.sent).toHaveLength(1);
        });

        test("replays the whole transaction when asked to, until it goes through", async () => {
            const conn = connection([
                [ok(), fail(notExecuted()), fail(conflict())],
                [ok(), fail(notExecuted()), fail(conflict())],
                [ok(), ok("done"), ok()],
            ]);

            const results = await executeTransaction(conn, undefined, ["UPDATE a"], FAST);

            expect(results).toEqual(["done"]);
            expect(conn.sent).toHaveLength(3);

            // The very same request each time
            expect(conn.sent[1].query.query).toBe(conn.sent[0].query.query);
            expect(conn.sent[2].query.query).toBe(conn.sent[0].query.query);
        });

        test("retries a conflict even though the error which arrives first is not one", async () => {
            // The regression this guards: retrying on the first error never retries anything,
            // as that is "not executed" rather than the conflict reported by the COMMIT.
            const conn = connection([
                [ok(), fail(notExecuted()), fail(notExecuted()), fail(conflict())],
                [ok(), ok("a"), ok("b"), ok()],
            ]);

            expect(
                await executeTransaction(conn, undefined, ["UPDATE a", "UPDATE b"], FAST),
            ).toEqual(["a", "b"]);
            expect(conn.sent).toHaveLength(2);
        });

        test("gives up after the configured attempts, throwing the conflict", async () => {
            const root = conflict();
            const conn = connection([[ok(), fail(notExecuted()), fail(root)]]);

            await expect(
                executeTransaction(conn, undefined, ["UPDATE a"], {
                    retry: { enabled: true, attempts: 2, retryDelay: 0, retryDelayMax: 0 },
                }),
            ).rejects.toBe(root);

            // The first attempt and two retries
            expect(conn.sent).toHaveLength(3);
        });

        test("does not retry an error which is not a conflict", async () => {
            const root = thrown();
            const conn = connection([[ok(), fail(root), fail(abortedCommit())]]);

            await expect(executeTransaction(conn, undefined, ["THROW 'boom'"], FAST)).rejects.toBe(
                root,
            );
            expect(conn.sent).toHaveLength(1);
        });

        test("does not retry an error of the request", async () => {
            const conn = connection([new ValidationError({ kind: "Validation", message: "nope" })]);

            await expect(executeTransaction(conn, undefined, ["RETURN 1"], FAST)).rejects.toThrow(
                "nope",
            );
            expect(conn.sent).toHaveLength(1);
        });

        test("inherits the retry configured on the connection", async () => {
            const conn = connection(
                [
                    [ok(), fail(conflict())],
                    [ok(), ok("a"), ok()],
                ],
                { retry: { enabled: true } },
            );

            expect(await executeTransaction(conn, undefined, ["UPDATE a"])).toEqual(["a"]);
            expect(conn.sent).toHaveLength(2);
        });

        test("can turn off the retry configured on the connection", async () => {
            const conn = connection([[ok(), fail(conflict())]], { retry: { enabled: true } });

            await expect(
                executeTransaction(conn, undefined, ["UPDATE a"], { retry: false }),
            ).rejects.toThrow("conflict");
            expect(conn.sent).toHaveLength(1);
        });

        test("layers the retry options over those of the connection", async () => {
            const conn = connection([[ok(), fail(conflict())]], {
                retry: { enabled: true, attempts: 5 },
            });

            await expect(
                executeTransaction(conn, undefined, ["UPDATE a"], { retry: { attempts: 1 } }),
            ).rejects.toThrow("conflict");

            // The first attempt and one retry
            expect(conn.sent).toHaveLength(2);
        });

        test("shorthand opts in with the defaults of the connection", async () => {
            const conn = connection([
                [ok(), fail(conflict())],
                [ok(), ok("a"), ok()],
            ]);

            expect(
                await executeTransaction(conn, undefined, ["UPDATE a"], { retry: true }),
            ).toEqual(["a"]);
        });

        test("a custom predicate is given the root cause", async () => {
            const seen: unknown[] = [];
            const root = thrown("custom conflict");
            const conn = connection([
                [ok(), fail(notExecuted()), fail(root), fail(abortedCommit())],
            ]);

            await expect(
                executeTransaction(conn, undefined, ["THROW 'x'"], {
                    retry: {
                        enabled: true,
                        attempts: 1,
                        retryDelay: 0,
                        retryDelayMax: 0,
                        retryable: (error) => {
                            seen.push(error);
                            return true;
                        },
                    },
                }),
            ).rejects.toBe(root);

            expect(seen).toEqual([root, root]);
            expect(conn.sent).toHaveLength(2);
        });
    });
});

describe("Surreal.transaction", () => {
    test("rejects anything but an array of queries", async () => {
        const db = new Surreal();

        await expect(db.transaction("RETURN 1" as never)).rejects.toThrow(
            "transaction() expects an array of queries",
        );
        await expect(db.transaction((async () => {}) as never)).rejects.toThrow(
            "transaction() expects an array of queries",
        );
    });

    test("needs a connection", async () => {
        await expect(new Surreal().transaction(["RETURN 1"])).rejects.toThrow(
            "You must be connected",
        );
    });

    test("is available on a session, but not inside an interactive transaction", () => {
        const id = new Uuid("92b84bde-39c8-4b4b-92f7-626096d6c4d9");
        const interactive = new SurrealTransaction(connection([]), undefined, id);

        expect(typeof new Surreal().transaction).toBe("function");
        expect("transaction" in interactive).toBe(false);
    });
});
