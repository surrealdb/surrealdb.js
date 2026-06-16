/**
 * Scope input accepted by write/session calls and read lenses.
 *
 * The API wire format is a {@link https://surrealdb.com/platform/spectron | ScopeSets}:
 * a DNF (disjunctive-normal-form) selector shaped as `string[][]`. The outer array
 * is an OR of clauses; each inner array is an AND of hierarchical `key/value`
 * slash-path strings, so `[["team/a"], ["team/b", "clearance/secret"]]` means
 * `team/a OR (team/b AND clearance/secret)`.
 *
 * For ergonomics this client also accepts a bare path string (a single-path clause)
 * and a flat string array (an OR of single-path clauses), and the two mix. So
 * `"team/eng"` is `[["team/eng"]]`, `["a", "b"]` is `[["a"], ["b"]]` (a OR b), and
 * you nest to express an AND: `[["a", "b"]]` is `a AND b`.
 */
export type Scope = string | Array<string | string[]> | null | undefined;

/**
 * Normalises a {@link Scope} input to the wire `ScopeSets` (a DNF selector,
 * `string[][]`: an OR of clauses, each clause an AND of `key/value` slash-paths).
 *
 * A bare string becomes one single-path clause. Each element of the outer array
 * becomes a clause: a string element is a one-path clause, an array element is an
 * AND clause of its paths. Within each clause empty strings are dropped and paths
 * are de-duplicated preserving first-seen order; a clause that ends up empty is
 * dropped (empty clauses are rejected on the wire).
 *
 * @param scope Scope input in any accepted shape.
 * @returns The normalised DNF selector, or `undefined` when no non-empty clause
 *   remains (so callers can omit the field entirely and use the key's default
 *   write region).
 */
export function normaliseScope(scope?: Scope): string[][] | undefined {
    if (scope === undefined || scope === null) return undefined;

    const clauses: Array<string | string[]> = typeof scope === "string" ? [scope] : scope;

    const out: string[][] = [];
    for (const clause of clauses) {
        const paths = typeof clause === "string" ? [clause] : clause;
        const deduped = [...new Set(paths.filter((p) => p.length > 0))];
        if (deduped.length > 0) out.push(deduped);
    }

    return out.length > 0 ? out : undefined;
}
