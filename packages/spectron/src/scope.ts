/**
 * Scope input accepted by write/session calls.
 *
 * The API wire format is a {@link https://surrealdb.com/platform/spectron | ScopeSet}:
 * an ordered, de-duplicated set of hierarchical `key/value` slash-path strings. For
 * ergonomics this client also accepts a single path string, a `key → value` map, or
 * an array of `[key, value]` tuples and normalises them to that wire form.
 */
export type Scope =
    | string
    | string[]
    | Record<string, string>
    | [string, string][]
    | null
    | undefined;

function isTupleArray(value: unknown[]): value is [string, string][] {
    return value.length > 0 && Array.isArray(value[0]);
}

/**
 * Normalises a {@link Scope} input to the wire `ScopeSet` (an ordered,
 * de-duplicated array of `key/value` slash-path strings).
 *
 * Mappings and `[key, value]` tuples become `key/value` paths; path strings pass
 * through. Empty strings are dropped and duplicates are removed while preserving
 * first-seen order.
 *
 * @param scope Scope input in any accepted shape.
 * @returns The normalised path list, or `undefined` when empty (so callers can
 *   omit the field entirely and use the key's default write region).
 */
export function normaliseScope(scope?: Scope): string[] | undefined {
    if (scope === undefined || scope === null) return undefined;

    let paths: string[];
    if (typeof scope === "string") {
        paths = [scope];
    } else if (Array.isArray(scope)) {
        paths = isTupleArray(scope)
            ? (scope as [string, string][]).map(([k, v]) => `${k}/${v}`)
            : (scope as string[]).slice();
    } else {
        paths = Object.entries(scope).map(([k, v]) => `${k}/${v}`);
    }

    const out = [...new Set(paths.filter((p) => p.length > 0))];
    return out.length > 0 ? out : undefined;
}
