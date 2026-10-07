import { describe, expect, test } from "bun:test";
import { InternalError, QueryError, ThrownError } from "../../../sdk/src/errors";
import { findRootCause, isSecondaryError } from "../../../sdk/src/internal/root-cause";
import {
    abortedCommit,
    cancelled,
    conflict,
    notExecuted,
    thrown,
} from "./__helpers__/scripted-connection";

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

    // What SurrealDB 3.0.0 reports for a conflict, as recorded from its CI run: unstructured, and
    // worded like a "not executed" error, yet it is the failure itself and what a retry needs.
    test("a conflict from SurrealDB 3.0.0 is a failure, although it says the query was not executed", () => {
        const conflict30 = new InternalError({
            kind: "Internal",
            message:
                "Query not executed: Transaction conflict: Resource busy: . This transaction can be retried",
        });
        const secondary = new InternalError({
            kind: "Internal",
            message: "The query was not executed due to a failed transaction",
        });

        expect(isSecondaryError(conflict30)).toBe(false);

        // Among the errors of a transaction, it is the one which is found
        expect(findRootCause([secondary, conflict30])).toBe(conflict30);
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
        expect(findRootCause([])).toBeUndefined();
    });

    // BEGIN; CREATE a; THROW 'boom'; CREATE b; COMMIT;
    test("is not the first error: the statements before the failure are rewritten to errors", () => {
        const root = thrown();

        expect(findRootCause([notExecuted(), root, cancelled(), abortedCommit()])).toBe(root);
    });

    // BEGIN; UPDATE c; UPDATE d; COMMIT; with a conflict on the commit
    test("finds a failure to commit, which is the last error", () => {
        const root = conflict();

        expect(findRootCause([notExecuted(), notExecuted(), root])).toBe(root);
    });

    test("finds a failure in the first statement", () => {
        const root = thrown();

        expect(findRootCause([root, cancelled(), abortedCommit()])).toBe(root);
    });

    test("finds a failure in the last statement", () => {
        const root = thrown();

        expect(findRootCause([notExecuted(), notExecuted(), root])).toBe(root);
    });

    test("falls back to the first error when every error is secondary", () => {
        const first = notExecuted();

        expect(findRootCause([first, cancelled()])).toBe(first);
    });

    test("finds the failure among errors from a server without structured errors", () => {
        const secondary = new InternalError({
            kind: "Internal",
            message: "The query was not executed due to a failed transaction",
        });
        const root = new InternalError({ kind: "Internal", message: "An error occurred: boom" });

        expect(findRootCause([secondary, root])).toBe(root);
    });

    test("is the first error when none of them is secondary, as for a query without a transaction", () => {
        const first = thrown("first");

        expect(findRootCause([first, thrown("second")])).toBe(first);
    });

    test("takes any iterable", () => {
        const root = thrown();

        expect(findRootCause(new Set([notExecuted(), root]))).toBe(root);
    });
});
