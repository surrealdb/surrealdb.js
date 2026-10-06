/**
 * Queries which are to be run as another identity than the session, which `.as()` makes.
 *
 * The mark is on the {@link BoundQuery} such a query sends, which is also what a query builder
 * compiles to and what a `Query` exposes as `inner`, so that whatever is combined with others can be
 * recognized by it, however it was configured after `.as()`.
 */
const credentialed = new WeakSet<object>();

/**
 * Mark a query as one which runs as another identity than the session.
 */
export function markCredentialed<T extends object>(query: T): T {
    credentialed.add(query);
    return query;
}

/**
 * Whether a query runs as another identity than the session.
 */
export function isCredentialed(query: object): boolean {
    return credentialed.has(query);
}
