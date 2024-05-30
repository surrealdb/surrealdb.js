import type { SemVer } from "@std/semver";
import { parse, parseRange } from "@std/semver";
import { satisfies } from "@std/semver";
import { UnsupportedVersion, VersionRetrievalFailure } from "../errors.ts";

export const supportedSurrealDbVersionRange = parseRange(">= 1.4.2 < 2.0.0");

export function versionCheck(version: SemVer): true {
	if (!isVersionSupported(version)) {
		throw new UnsupportedVersion(version, supportedSurrealDbVersionRange);
	}

	return true;
}

export function isVersionSupported(version: SemVer): boolean {
	return satisfies(version, supportedSurrealDbVersionRange);
}

export async function retrieveRemoteVersion(
	url: URL,
	timeout: number,
): Promise<SemVer> {
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

		return parse(version);
	}

	throw new VersionRetrievalFailure();
}
