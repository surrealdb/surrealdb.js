import { QueryError, type ServerError } from "../errors";

/**
 * Pattern for the errors which servers without structured errors report for the statements
 * of a transaction that did not run because of another statement's failure.
 */
const LEGACY_SECONDARY = /^The query was not executed due to a (failed|cancelled) transaction/;

/**
 * Whether an error only says that a statement did not run because something else in its
 * transaction failed, as opposed to being the failure itself.
 *
 * When a statement fails in a transaction, the server rolls it back and reports every other
 * statement as an error too: those before it as "not executed due to a failed transaction",
 * those after it as "not executed due to a cancelled transaction", and the `COMMIT` as
 * "aborted due to a prior error". Those errors are consequences, never causes.
 */
export function isSecondaryError(error: ServerError): boolean {
    if (error instanceof QueryError && (error.isNotExecuted || error.isCancelled)) {
        return true;
    }

    // Servers without structured error details only send the message
    return !error.details && LEGACY_SECONDARY.test(error.message);
}

/**
 * Find the error which made a query fail, among the errors of its statements.
 *
 * It is **not** the first error in order, when the query holds a transaction: the statements
 * which precede the failing one are rewritten to errors too, so the real one can arrive late.
 * A transaction which fails to commit because of a conflict, for instance, reports the
 * conflict on the `COMMIT`, after an error for every statement before it.
 *
 * For a query which holds no transaction there is nothing to skip, so this is the first error.
 *
 * @param errors The error of each statement which failed, in the order they were reported
 * @returns The first error which is not a consequence of another, or the first error if all are
 */
export function findRootCause(errors: Iterable<ServerError>): ServerError | undefined {
    let first: ServerError | undefined;

    for (const error of errors) {
        if (!isSecondaryError(error)) {
            return error;
        }

        first ??= error;
    }

    return first;
}
