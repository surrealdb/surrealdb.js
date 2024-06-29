import { afterAll } from "bun:test";
import Surreal from "../../src";
import { SURREAL_BIND, SURREAL_PORT_UNREACHABLE, SURREAL_USER } from "./env.ts";
import { SURREAL_PASS } from "./env.ts";
import { SURREAL_DB } from "./env.ts";
import { SURREAL_NS } from "./env.ts";
import { SURREAL_PORT } from "./env.ts";

export type Protocol = "http" | "ws";
export const PROTOCOL = process.env.SURREAL_PROTOCOL === "http" ? "http" : "ws";

declare global {
	var surrealProc: number;
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

export async function setupServer() {
	const proc = Bun.spawn(["surreal", "start"], {
		env: {
			SURREAL_BIND,
			SURREAL_USER,
			SURREAL_PASS,
		},
	});

	await Bun.sleep(1000);

	afterAll(async () => {
		proc.kill();
	});

	async function createSurreal({
		protocol,
		auth,
		reachable,
	}: {
		protocol?: Protocol;
		auth?: PremadeAuth;
		reachable?: boolean;
	} = {}) {
		protocol = protocol ? protocol : PROTOCOL;
		const surreal = new Surreal();
		const port = reachable === false ? SURREAL_PORT_UNREACHABLE : SURREAL_PORT;
		await surreal.connect(`${protocol}://127.0.0.1:${port}/rpc`, {
			namespace: SURREAL_NS,
			database: SURREAL_DB,
			auth: createAuth(auth ?? "root"),
		});

		afterAll(async () => await surreal.close());
		return surreal;
	}

	return { createSurreal };
}
