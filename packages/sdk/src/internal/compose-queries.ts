import { ExpressionError } from "../errors";
import { ManagedLivePromise } from "../query/live";
import type { CompilableQuery, InnerQuery, QueryLike } from "../types";
import { BoundQuery } from "../utils/bound-query";
import { scanStatements } from "./scan-statements";

/**
 * Separates the inputs of a composed query.
 *
 * The `;` sits on a line of its own, rather than directly after the previous input, so that
 * an input which ends in a line comment cannot swallow it. Empty statements are valid
 * SurrealQL, so an input which already ends in a `;` is fine too.
 */
const SEPARATOR = "\n;\n";

function describe(input: unknown): string {
    if (input === null) return "null";
    if (typeof input === "object") return input.constructor?.name ?? "an object";
    return typeof input;
}

function isCompilable(input: unknown): input is CompilableQuery {
    return (
        typeof input === "object" &&
        input !== null &&
        typeof (input as CompilableQuery).compile === "function"
    );
}

/**
 * Whether the input is a `Query`, which exposes the query it will send as `inner`.
 *
 * Checked by shape rather than with `instanceof`, so that a `Query` created by another copy
 * of the library is recognized just like a `BoundQuery` is.
 */
function hasInner(input: unknown): input is InnerQuery {
    return (
        typeof input === "object" &&
        input !== null &&
        "inner" in input &&
        (input as { inner: unknown }).inner instanceof BoundQuery
    );
}

function toBoundQuery(input: unknown, index: number, name: string): BoundQuery {
    let query: BoundQuery;

    if (typeof input === "string") {
        query = new BoundQuery(input);
    } else if (input instanceof BoundQuery) {
        query = input as unknown as BoundQuery;
    } else if (hasInner(input)) {
        query = input.inner;
    } else if (input instanceof ManagedLivePromise) {
        throw new ExpressionError(
            `${name}[${index}] is a live query, which cannot be combined with other queries. Use live() instead`,
        );
    } else if (isCompilable(input)) {
        query = input.compile();

        if (!(query instanceof BoundQuery)) {
            throw new ExpressionError(`${name}[${index}].compile() did not return a BoundQuery`);
        }
    } else {
        throw new ExpressionError(
            `${name}[${index}] is not a query: expected a string, a BoundQuery, a query builder or a Query, but received ${describe(input)}`,
        );
    }

    // An empty input would occupy no result slot, quietly shifting the position of every
    // result which follows it. It is nearly always a mistake, so say so.
    if (query.query.trim() === "") {
        throw new ExpressionError(`${name}[${index}] is empty`);
    }

    return query;
}

/**
 * Convert each input into the {@link BoundQuery} it stands for, rejecting anything which is
 * not a query, is empty, or is a live query.
 *
 * @param inputs The inputs to convert
 * @param name How the caller names the array, used when reporting the index of a bad input
 */
export function resolveQueries(inputs: readonly QueryLike[], name = "queries"): BoundQuery[] {
    if (!Array.isArray(inputs)) {
        throw new ExpressionError(`${name} must be an array of queries`);
    }

    return inputs.map((input, index) => toBoundQuery(input, index, name));
}

/**
 * Combine already resolved queries into a single {@link BoundQuery}, as if their statements
 * had been written one after another in a single query.
 *
 * The combined query is **not** atomic, and each statement keeps its own result: an input
 * which holds several statements contributes several results.
 *
 * Bindings are merged into one set. Two inputs binding the same name is a conflict, because
 * one of the two would silently read the other's value. The `surql` template tag and the
 * query builders never conflict, as they generate unique names, but hand written
 * `BoundQuery` instances can.
 *
 * @param queries The queries to combine
 * @param name How the caller names the array, used when reporting a conflict
 */
export function joinQueries(queries: readonly BoundQuery[], name = "queries"): BoundQuery {
    const bindings: Record<string, unknown> = {};
    const owners = new Map<string, number>();
    const parts: string[] = [];

    for (const [index, query] of queries.entries()) {
        for (const [key, value] of Object.entries(query.bindings)) {
            const owner = owners.get(key);

            if (owner !== undefined) {
                throw new ExpressionError(
                    `Parameter conflict: '$${key}' is bound by both ${name}[${owner}] and ${name}[${index}]. Each query needs its own parameter names, which the surql template tag generates for you`,
                );
            }

            owners.set(key, index);
            bindings[key] = value;
        }

        parts.push(query.query);
    }

    return new BoundQuery(parts.join(SEPARATOR), bindings);
}

/**
 * Combine the inputs of `query([...])` into a single {@link BoundQuery}.
 */
export function composeQueries(inputs: readonly QueryLike[]): BoundQuery {
    return joinQueries(resolveQueries(inputs));
}

const TRANSACTION_CONTROL = new Set(["BEGIN", "COMMIT", "CANCEL"]);

/**
 * Check that queries can be wrapped in a transaction, and run to completion once they are.
 *
 * - `BEGIN`, `COMMIT` and `CANCEL` are rejected, as `transaction()` supplies its own. A
 *   `COMMIT` among the queries would commit early, and a `CANCEL` would throw it all away.
 * - A `RETURN` which is followed by another statement is rejected. Inside a transaction a
 *   `RETURN` ends it: the statements after it are skipped, yet the transaction still commits.
 *   That would drop part of the work without an error, and shorten the results. Statements
 *   which produce a value without ending the transaction, such as `SELECT` or a bare
 *   expression, are fine, as is a `RETURN` which comes last.
 *
 * A `RETURN` nested inside a block, such as an `IF`, ends a transaction just the same, but
 * cannot be told apart from a block which merely produces a value without understanding
 * SurrealQL in full, so it is not detected.
 *
 * @param queries The queries which would be wrapped
 * @param name How the caller names the array, used when reporting the index of an input
 */
export function assertTransactionSafe(queries: readonly BoundQuery[], name = "queries"): void {
    let returned: number | undefined;

    for (const [index, query] of queries.entries()) {
        for (const keyword of scanStatements(query.query)) {
            if (TRANSACTION_CONTROL.has(keyword)) {
                throw new ExpressionError(
                    `${name}[${index}] contains a ${keyword} statement. transaction() wraps the queries in BEGIN and COMMIT itself, so they must not contain any`,
                );
            }

            if (returned !== undefined) {
                throw new ExpressionError(
                    `${name}[${returned}] contains a RETURN statement which is followed by another statement (in ${name}[${index}]). Inside a transaction RETURN ends it early: the statements after it would be skipped but the transaction would still commit. Use SELECT or a bare expression instead, or move the RETURN to the end`,
                );
            }

            if (keyword === "RETURN") {
                returned = index;
            }
        }
    }
}
