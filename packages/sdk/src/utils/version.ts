import { UnsupportedVersion } from "../errors.ts";
import type { Version } from "../types";

export const MINIMUM_VERSION: Version = "2.0.0";
export const MAXIMUM_VERSION: Version = "4.0.0";
export const VERSION_SUPPORT_RANGE: string = `>= ${MINIMUM_VERSION} < ${MAXIMUM_VERSION}`;

/**
 * Check if the current driver version is compatible with the provided
 * version of SurrealDB.
 *
 * @param version The version of SurrealDB to check against
 * @param min Custom minimum version to check against
 * @param until Custom maximum version to check against
 * @throws UnsupportedVersion if the version is not supported
 */
export function versionCheck(
	version: string,
	min: Version = MINIMUM_VERSION,
	until: Version = MAXIMUM_VERSION,
): true {
	if (!isVersionSupported(version, min, until)) {
		throw new UnsupportedVersion(version, `>= ${min} < ${until}`);
	}

	return true;
}

/**
 * Returns whether the current driver version is compatible with the provided
 * version of SurrealDB.
 *
 * @param version The version of SurrealDB to check against
 * @param min Custom minimum version to check against
 * @param until Custom maximum version to check against
 * @returns true if the version is supported, false otherwise
 */
export function isVersionSupported(
	version: string,
	min: Version = MINIMUM_VERSION,
	until: Version = MAXIMUM_VERSION,
): boolean {
	const trimmed = version.replace("surrealdb-", "").trim();

	return (
		min.localeCompare(trimmed, undefined, {
			numeric: true,
		}) <= 0 &&
		until.localeCompare(trimmed, undefined, {
			numeric: true,
		}) === 1
	);
}
