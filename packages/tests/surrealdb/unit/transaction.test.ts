import { describe, expect, test } from "bun:test";
import { Uuid } from "@surrealdb/sqon";
import { Surreal } from "../../../sdk/src/api/surreal";
import { SurrealTransaction } from "../../../sdk/src/api/transaction";
import { ExpressionError, ValidationError } from "../../../sdk/src/errors";
import { executeTransaction, unwrapResults } from "../../../sdk/src/internal/transaction";
import type { TransactionOptions } from "../../../sdk/src/types";
import { BoundQuery } from "../../../sdk/src/utils/bound-query";
import { surql } from "../../../sdk/src/utils/tagged-template";
import {
    abortedCommit,
    cancelled,
    conflict,
    connection,
    fail,
    notExecuted,
    ok,
    thrown,
    toResponses,
} from "./__helpers__/scripted-connection";

const FAST: TransactionOptions = { retry: { enabled: true, retryDelay: 0, retryDelayMax: 0 } };

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

    describe("a RETURN, which depends on the version of the server", () => {
        test("is allowed last on SurrealDB 3.0 and later", async () => {
            const conn = connection([[ok(), ok("a"), ok(7), ok()]], { version: "surrealdb-3.0.0" });

            expect(await executeTransaction(conn, undefined, ["'a'", "RETURN 7"])).toEqual([
                "a",
                7,
            ]);
        });

        test("is allowed last when the version is not known", async () => {
            const conn = connection([[ok(), ok(7), ok()]], { version: null });

            expect(await executeTransaction(conn, undefined, ["RETURN 7"])).toEqual([7]);
        });

        test("is rejected before SurrealDB 3.0, even last, without sending anything", async () => {
            for (const version of ["surrealdb-2.2.7", "surrealdb-2.3.7", "surrealdb-2.9.9"]) {
                const conn = connection([[ok(7)]], { version });

                await expect(
                    executeTransaction(conn, undefined, ["'a'", "RETURN 7"]),
                ).rejects.toThrow(/queries\[1\] contains a RETURN statement.*before 3\.0/);
                expect(conn.sent).toHaveLength(0);
            }
        });

        test("is not a problem before SurrealDB 3.0 when there is none", async () => {
            const conn = connection([[ok("a"), ok("b")]], { version: "surrealdb-2.2.7" });

            expect(await executeTransaction(conn, undefined, ["'a'", "'b'"])).toEqual(["a", "b"]);
        });
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
