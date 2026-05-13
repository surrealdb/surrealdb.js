/** Scope dimensions as a plain key/value map (string values). */
export type Scope = Record<string, string>;

/**
 * Serialises a scope object to the API wire format (`scope_attribute` set).
 * @param scope Optional map; omit or pass empty object when not needed.
 */
export function serialiseScope(scope?: Scope): { key: string; value: string }[] | undefined {
    if (scope === undefined || Object.keys(scope).length === 0) return undefined;
    return Object.entries(scope).map(([key, value]) => ({
        key: String(key),
        value: String(value),
    }));
}

/** Converts wire scope entries back to a map. */
export function deserialiseScope(wire?: { key: string; value: string }[] | null): Scope {
    if (!wire?.length) return {};
    const out: Scope = {};
    for (const entry of wire) {
        if (entry.key != null && entry.value != null) {
            out[String(entry.key)] = String(entry.value);
        }
    }
    return out;
}
