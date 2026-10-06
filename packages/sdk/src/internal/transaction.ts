import type { ConnectionController } from "../controller";
import { QueryError, type ServerError, UnexpectedServerResponseError } from "../errors";
import { Query } from "../query/query";
import type { QueryLike, QueryResponse, Session, TransactionOptions } from "../types";
import { BoundQuery } from "../utils/bound-query";
import { isVersionSupported } from "../utils/is-version-supported";
import { assertTransactionSafe, joinQueries, resolveQueries } from "./compose-queries";
import { RetryContext } from "./retry";

/**
 * The first version of SurrealDB to give a transaction the results which `transaction()`
 * relies on. Before it:
 *
 * - the results hold only the statements between the `BEGIN` and the `COMMIT`, which are not
 *   reported themselves;
 * - a `RETURN` replaces the results of every statement before it with its own, so what a
 *   transaction resolves to can no longer be matched to the queries which were passed.
 */
const MODERN_TRANSACTIONS_SINCE = "3.0.0";

/**
 * Whether a server reports a result for the `BEGIN` and `COMMIT` of a transaction, and keeps
 * the results of the statements before a `RETURN`.
 *
 * The SDK only supports servers up to 3.x, so a connection whose version is not known is
 * expected to be a recent one.
 */
function isModernTransaction(version: string | undefined): boolean {
    return version === undefined || isVersionSupported(version, MODERN_TRANSACTIONS_SINCE);
}

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
 * Find the error which made a transaction fail, among the responses of its statements.
 *
 * It is **not** the first error in order: the statements which precede the failing one are
 * rewritten to errors too, so the real one can arrive late. A transaction which fails to
 * commit because of a conflict, for instance, reports the conflict on the `COMMIT`, after
 * an error for every statement before it.
 *
 * @param responses The response of each statement
 * @returns The first error which is not a consequence of another, or the first error if all are
 */
export function findRootCause(responses: readonly QueryResponse[]): ServerError | undefined {
    let first: ServerError | undefined;

    for (const response of responses) {
        if (!response || response.success) continue;

        if (!isSecondaryError(response.error)) {
            return response.error;
        }

        first ??= response.error;
    }

    return first;
}

/**
 * Take the results of the statements the caller asked for out of the responses of a
 * transaction which succeeded, leaving out those of the `BEGIN` and `COMMIT` around them.
 *
 * @param responses The response of each statement, none of which failed
 * @param version The version of the server which produced them
 */
export function unwrapResults(
    responses: readonly QueryResponse[],
    version: string | undefined,
): unknown[] {
    const control = isModernTransaction(version) ? 1 : 0;

    if (responses.length < control * 2) {
        throw new UnexpectedServerResponseError(
            `Expected the transaction to report BEGIN and COMMIT, but it reported ${responses.length} results`,
        );
    }

    const results: unknown[] = [];

    for (let index = control; index < responses.length - control; index++) {
        const response = responses[index];

        if (!response?.success) {
            throw new UnexpectedServerResponseError(
                `Statement ${index - control} of the transaction did not report a result`,
            );
        }

        results.push(response.result);
    }

    return results;
}

/**
 * Wrap already combined queries in a transaction, as a single query.
 */
function wrapInTransaction(body: BoundQuery): BoundQuery {
    // Each part is on its own line, so that a trailing line comment cannot swallow the `;`
    return new BoundQuery(`BEGIN;\n${body.query}\n;\nCOMMIT;`, body.bindings);
}

/**
 * Execute queries atomically as one request, without any state held on the connection.
 *
 * @param connection The connection to run the queries on
 * @param session The session to run the queries in
 * @param queries The queries to run
 * @param options Options to configure the transaction
 * @returns The result of each statement of the queries
 */
export async function executeTransaction<R extends unknown[]>(
    connection: ConnectionController,
    session: Session,
    queries: readonly QueryLike[],
    options: TransactionOptions = {},
): Promise<R> {
    const resolved = resolveQueries(queries);

    // Nothing to do is atomic by definition
    if (resolved.length === 0) {
        return [] as unknown as R;
    }

    // What a transaction may hold depends on the version of the server
    await connection.ready();

    assertTransactionSafe(resolved, "queries", {
        returnReplacesResults: !isModernTransaction(connection.serverVersion),
    });

    const query = new Query(connection, {
        query: wrapInTransaction(joinQueries(resolved)),
        transaction: undefined,
        session,
        json: false,
    });

    const context = new RetryContext(RetryContext.mergeOptions(options.retry, connection.retry));

    return context.run(async () => {
        const responses = await query.responses();
        const cause = findRootCause(responses);

        if (cause) {
            throw cause;
        }

        return unwrapResults(responses, connection.serverVersion) as R;
    });
}
