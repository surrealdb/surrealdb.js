import { UnsupportedVersion, VersionRetrievalFailure } from "../errors.ts";

type Version = `${number}.${number}.${number}`;
export const defaultVersionCheckTimeout = 5000;
export const supportedSurrealDbVersionMin: Version = "1.4.2";
export const supportedSurrealDbVersionUntil: Version = "3.0.0";
export const supportedSurrealDbVersionRange: string = `>= ${supportedSurrealDbVersionMin} < ${supportedSurrealDbVersionUntil}`;

export function versionCheck(
	version: string,
	min: Version = supportedSurrealDbVersionMin,
	until: Version = supportedSurrealDbVersionUntil,
): true {
	if (!isVersionSupported(version, min, until)) {
		throw new UnsupportedVersion(version, `>= ${min} < ${until}`);
	}

	return true;
}

export function isVersionSupported(
	version: string,
	min: Version = supportedSurrealDbVersionMin,
	until: Version = supportedSurrealDbVersionUntil,
): boolean {
	return (
		min.localeCompare(version, undefined, {
			numeric: true,
		}) <= 0 &&
		until.localeCompare(version, undefined, {
			numeric: true,
		}) === 1
	);
}

/**
 * Query the version of a remote SurrealDB instance
 * @param url - The URL of the remote SurrealDB instance
 * @param timeout - The timeout in milliseconds for the request
 * @returns
 */
export async function retrieveRemoteVersion(
	url: URL,
	timeout?: number,
): Promise<Version> {
	const mappedProtocols = {
		"ws:": "http:",
		"wss:": "https:",
		"http:": "http:",
		"https:": "https:",
	} as Record<string, string>;

	const protocol = mappedProtocols[url.protocol];
	if (protocol) {
		const basepath = url.pathname.slice(0, -4);
		// biome-ignore lint/style/noParameterAssign: need to clone URL instance to prevent altering the original
		url = new URL(url);
		url.pathname = `${basepath}/version`;
		url.protocol = protocol;

		const controller = new AbortController();
		const id = setTimeout(
			() => controller.abort(),
			timeout ?? defaultVersionCheckTimeout,
		);
		const versionPrefix = "surrealdb-";
		const version = await fetch(url, {
			signal: controller.signal,
		})
			.then((res) => res.text())
			.then((version) => version.slice(versionPrefix.length))
			.catch((e) => {
				throw new VersionRetrievalFailure(e);
			})
			.finally(() => {
				clearTimeout(id);
			});

		return version as Version;
	}

	throw new VersionRetrievalFailure();
}
