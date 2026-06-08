/**
 * Scope input accepted by write/session calls.
 *
 * The API wire format is a {@link https://surrealdb.com/platform/spectron | ScopeSet}:
 * an ordered set of hierarchical `key=value/` path strings. For ergonomics this
 * client also accepts a single path string, a `key → value` map, or an array of
 * `[key, value]` tuples and normalises them to that wire form.
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
 * Normalises a {@link Scope} input to the wire `ScopeSet` (an array of
 * `key=value` path strings).
 *
 * @param scope Scope input in any accepted shape.
 * @returns The normalised path list, or `undefined` when empty (so callers can
 *   omit the field entirely).
 */
export function normaliseScope(scope?: Scope): string[] | undefined {
    if (scope === undefined || scope === null) return undefined;

    let paths: string[];
    if (typeof scope === "string") {
        paths = scope.length > 0 ? [scope] : [];
    } else if (Array.isArray(scope)) {
        paths = isTupleArray(scope)
            ? (scope as [string, string][]).map(([k, v]) => `${k}=${v}`)
            : (scope as string[]).slice();
    } else {
        paths = Object.entries(scope).map(([k, v]) => `${k}=${v}`);
    }

    return paths.length > 0 ? paths : undefined;
}
