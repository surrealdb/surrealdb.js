import type { ConnectionController } from "../controller";
import { UnexpectedServerResponseError } from "../errors";
import { Query } from "../query/query";
import type { QueryLike, QueryResponse, Session, TransactionOptions } from "../types";
import { BoundQuery } from "../utils/bound-query";
import { isVersionSupported } from "../utils/is-version-supported";
import { abortScope, addSignal, assertTimeout, raceAbort, throwIfAborted } from "./abort";
import { assertTransactionSafe, joinQueries, resolveQueries } from "./compose-queries";
import { RetryContext } from "./retry";
import { findRootCause } from "./root-cause";

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
 * @param signals The signals of the view this is run from, which abandon the transaction as the
 *                `signal` option does
 * @returns The result of each statement of the queries
 */
export async function executeTransaction<R extends unknown[]>(
    connection: ConnectionController,
    session: Session,
    queries: readonly QueryLike[],
    options: TransactionOptions = {},
    signals?: readonly AbortSignal[],
): Promise<R> {
    if (options.requestTimeout !== undefined) {
        assertTimeout(options.requestTimeout, "requestTimeout");
    }

    // The signals of the transaction, to which the request, and the wait to retry it, are bound
    const all = addSignal(signals, options.signal);
    const scope = abortScope(all ?? []);

    try {
        // Nothing is sent for a transaction which has been abandoned already
        throwIfAborted(scope.signal);

        const resolved = resolveQueries(queries);

        // Nothing to do is atomic by definition
        if (resolved.length === 0) {
            return [] as unknown as R;
        }

        // What a transaction may hold depends on the version of the server
        await raceAbort(connection.ready(), scope.signal);

        assertTransactionSafe(resolved, "queries", {
            returnReplacesResults: !isModernTransaction(connection.serverVersion),
        });

        // A query like any other, which is abandoned by the signals and held to the request timeout
        // on every attempt, so a retry gets the whole of it
        const query = new Query(connection, {
            query: wrapInTransaction(joinQueries(resolved)),
            transaction: undefined,
            session,
            json: false,
            signals: all,
            requestTimeout: options.requestTimeout,
        });

        const context = new RetryContext(
            RetryContext.mergeOptions(options.retry, connection.retry),
            scope.signal,
        );

        return await context.run(async () => {
            const responses = await query.responses();
            const cause = findRootCause(
                responses.flatMap((r) => (r && !r.success ? [r.error] : [])),
            );

            if (cause) {
                throw cause;
            }

            return unwrapResults(responses, connection.serverVersion) as R;
        });
    } finally {
        scope.dispose();
    }
}
