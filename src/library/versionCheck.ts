import semver from "npm:semver";
import { UnsupportedVersion, VersionRetrievalFailure } from "../errors.ts";

export const supportedSurrealDbVersionRange = ">= 1.4.2 < 2.0.0";

export function versionCheck(version: string): true {
	if (!isVersionSupported(version)) {
		throw new UnsupportedVersion(version, supportedSurrealDbVersionRange);
	}

	return true;
}

export function isVersionSupported(version: string) {
	return semver.satisfies(version, supportedSurrealDbVersionRange);
}

export async function retrieveRemoteVersion(url: URL, timeout = 5) {
	const mappedProtocols = {
		"ws:": "http:",
		"wss:": "https:",
		"http:": "http:",
		"https:": "https:",
	} as Record<string, string>;

	const protocol = mappedProtocols[url.protocol];
	if (protocol) {
		url = new URL(url);
		url.protocol = protocol;
		url.pathname = url.pathname.slice(0, -4) + "/version";

		const versionPrefix = "surrealdb-";
		const version = await fetch(
			url,
			{
				signal: AbortSignal.timeout(timeout)
			}
		)
			.then((res) => res.text())
			.then((version) => version.slice(versionPrefix.length))
			.catch(() => {
				throw new VersionRetrievalFailure();
			});

		return version;
	}

	throw new VersionRetrievalFailure();
}
