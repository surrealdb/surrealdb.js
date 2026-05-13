/**
 * URL-encodes a single path segment (e.g. context id, entity name).
 * @param value Raw segment value.
 */
export function encodePathSegment(value: string): string {
    return encodeURIComponent(value);
}

/**
 * Returns the API path prefix for a Spectron context: `/api/v1/{contextId}`.
 * @param contextId Context identifier.
 */
export function getContextApiPrefix(contextId: string): string {
    return `/api/v1/${encodePathSegment(contextId)}`;
}
