import Surreal from "../../mod.ts";
import { SURREAL_USER } from "./env.ts";
import { SURREAL_PASS } from "./env.ts";
import { SURREAL_DB } from "./env.ts";
import { SURREAL_NS } from "./env.ts";
import { SURREAL_PORT } from "./env.ts";

type Protocol = "ws" | "http";
declare global {
	// deno-lint-ignore no-var
	var protocol: Protocol | undefined;
}

export async function createSurreal({
	protocol,
	auth,
	flatMode,
}: {
	protocol?: Protocol;
	auth?: PremadeAuth;
	flatMode?: boolean;
} = {}) {
	protocol = protocol
		? protocol
		: "protocol" in globalThis
		? (globalThis.protocol as Protocol)
		: "ws";
	const surreal = new Surreal({ flatMode });
	await surreal.connect(`${protocol}://127.0.0.1:${SURREAL_PORT}/rpc`, {
		namespace: SURREAL_NS,
		database: SURREAL_DB,
		auth: auth ? createAuth(auth) : auth,
	});

	return surreal;
}

type PremadeAuth = "root" | "invalid";
export function createAuth(auth: PremadeAuth) {
	switch (auth) {
		case "root": {
			return {
				username: SURREAL_USER,
				password: SURREAL_PASS,
			};
		}
		case "invalid": {
			return {
				username: "invalid",
				password: "invalid",
			};
		}
		default:
			throw new Error("Invalid auth option");
	}
}
