import { VersionCheckFailure } from "../errors";
import type { Version } from "../types";

const PROTOCOL_MAP: Record<string, string> = {
	"ws:": "http:",
	"wss:": "https:",
	"http:": "http:",
	"https:": "https:",
};

export function requestRpcVersion(
	url: URL,
	timeout?: number,
): Promise<Version> {
	// const protocol = PROTOCOL_MAP[url.protocol];
	// if (!protocol) {
	// 	throw new VersionCheckFailure("Unsupported protocol");
	// }
	// if (protocol) {
	// 	const basepath = url.pathname.slice(0, -4);
	// 	// biome-ignore lint/style/noParameterAssign: need to clone URL instance to prevent altering the original
	// 	url = new URL(url);
	// 	url.pathname = `${basepath}/version`;
	// 	url.protocol = protocol;
	// 	const controller = new AbortController();
	// 	const id = setTimeout(
	// 		() => controller.abort(),
	// 		timeout ?? defaultVersionCheckTimeout,
	// 	);
	// 	const versionPrefix = "surrealdb-";
	// 	const version = await fetch(url, {
	// 		signal: controller.signal,
	// 	})
	// 		.then((res) => res.text())
	// 		.then((version) => version.slice(versionPrefix.length))
	// 		.catch((e) => {
	// 			throw new VersionRetrievalFailure(e);
	// 		})
	// 		.finally(() => {
	// 			clearTimeout(id);
	// 		});
	// 	return version as Version;
	// }
	// throw new VersionRetrievalFailure();
}
