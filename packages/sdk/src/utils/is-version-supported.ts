export const MINIMUM_VERSION = "2.0.0";
export const MAXIMUM_VERSION = "4.0.0";

/**
 * Returns whether a SurrealDB version is supported by the SDK.
 *
 * @param version The SurrealDB version to check
 * @param min The minimum version to check against
 * @param until The maximum version to check against
 * @returns Whether the version is supported
 */
export function isVersionSupported(
    version: string,
    min: string = MINIMUM_VERSION,
    until: string = MAXIMUM_VERSION,
): boolean {
    const trimmed = version.replace(/^surrealdb-/, "").trim();

    return (
        min.localeCompare(trimmed, undefined, {
            numeric: true,
        }) <= 0 &&
        until.localeCompare(trimmed, undefined, {
            numeric: true,
        }) === 1
    );
}
