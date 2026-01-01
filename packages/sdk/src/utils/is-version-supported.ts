import type { RpcProtocolVersion } from "../types/rpc";

export const MINIMUM_VERSION = "2.0.0";
export const MAXIMUM_VERSION = "4.0.0";

/** The minimum SurrealDB version that supports RPC protocol v2 */
export const RPC_V2_MINIMUM_VERSION = "3.0.0";

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

/**
 * Returns the RPC protocol version to use for a given SurrealDB version.
 *
 * @param version The SurrealDB version string
 * @returns The RPC protocol version to use (1 for v2.x, 2 for v3.x+)
 */
export function getRpcProtocolVersion(version: string): RpcProtocolVersion {
    const trimmed = version.replace(/^surrealdb-/, "").trim();

    // Use RPC v2 for SurrealDB v3.0.0 and above
    const isV3OrAbove =
        RPC_V2_MINIMUM_VERSION.localeCompare(trimmed, undefined, {
            numeric: true,
        }) <= 0;

    return isV3OrAbove ? 2 : 1;
}
