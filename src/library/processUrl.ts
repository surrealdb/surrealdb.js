import { InvalidURLProvided } from "../errors.ts";

export function processUrl(
	url: string,
	replaceProtocols: Record<string, string>,
) {
	const { protocol, host } = matchUrl(url);
	const allowedProtocols = Object.entries(replaceProtocols)
		.flat()
		.map((a) => a.toLowerCase());
	if (!allowedProtocols.includes(protocol)) throw new InvalidURLProvided();
	return constructUrl(protocol, host, replaceProtocols);
}

function matchUrl(url: string) {
	const pattern = /^([^/:]+):\/\/([^/]+)/;
	const matched = url.match(pattern);

	if (!matched) throw new InvalidURLProvided();
	const [protocol, host] = [...matched]
		.slice(1, 3)
		.map((a) => a.toLowerCase());
	return { protocol, host };
}

function constructUrl(
	protocol: string,
	host: string,
	replaceProtocols: Record<string, string>,
) {
	protocol = protocol in replaceProtocols
		? replaceProtocols[protocol]
		: protocol;
	return `${protocol}://${host}`;
}
