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

export async function retrieveRemoteVersion(url: URL, timeout: number) {
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

		const controller = new AbortController();
		const id = setTimeout(() => controller.abort(), timeout);
		const versionPrefix = "surrealdb-";
		const version = await fetch(
			url,
			{
				signal: controller.signal,
			},
		)
			.then((res) => res.text())
			.then((version) => version.slice(versionPrefix.length))
			.catch(() => {
				throw new VersionRetrievalFailure();
			})
			.finally(() => {
				clearTimeout(id);
			});

		return version;
	}

	throw new VersionRetrievalFailure();
}
