import { afterAll } from "bun:test";
import Surreal, { type AnyAuth } from "../../src";
import { SURREAL_BIND, SURREAL_PORT_UNREACHABLE, SURREAL_USER } from "./env.ts";
import { SURREAL_PASS } from "./env.ts";
import { SURREAL_DB } from "./env.ts";
import { SURREAL_NS } from "./env.ts";
import { SURREAL_PORT } from "./env.ts";
import type { Subprocess } from "bun";

export type Protocol = "http" | "ws";
export const PROTOCOL: Protocol =
	process.env.SURREAL_PROTOCOL === "http" ? "http" : "ws";

declare global {
	var surrealProc: number;
}

type PremadeAuth = "root" | "invalid";
export function createAuth(auth: PremadeAuth): AnyAuth {
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

type CreateSurrealOptions = {
	protocol?: Protocol;
	auth?: PremadeAuth;
	reachable?: boolean;
	unselected?: boolean;
	reconnect?: boolean;
};

export async function spawnTestServer(): Promise<{
	createSurreal: (options?: CreateSurrealOptions) => Promise<Surreal>;
	startServer: () => Promise<void>;
	stopServer: () => Promise<void>;
}> {
	let server: Subprocess | undefined;

	async function startServer() {
		if (server) return;

		server = Bun.spawn(["surreal", "start"], {
			env: {
				SURREAL_BIND,
				SURREAL_USER,
				SURREAL_PASS,
			},
		});

		await Bun.sleep(1000);
	}

	async function stopServer() {
		if (!server) return;
		server.kill();
		server = undefined;
	}

	async function createSurreal({
		protocol,
		auth,
		reachable,
		unselected,
		reconnect,
	}: CreateSurrealOptions = {}) {
		protocol = protocol ? protocol : PROTOCOL;
		const surreal = new Surreal();
		const port = reachable === false ? SURREAL_PORT_UNREACHABLE : SURREAL_PORT;
		await surreal.connect(`${protocol}://127.0.0.1:${port}/rpc`, {
			namespace: unselected ? undefined : SURREAL_NS,
			database: unselected ? undefined : SURREAL_DB,
			auth: createAuth(auth ?? "root"),
			reconnect: reconnect ?? false,
			reconnectTimeout: 2500,
		});

		afterAll(async () => await surreal.close());
		return surreal;
	}

	afterAll(async () => {
		server?.kill();
	});

	await startServer();

	return { createSurreal, startServer, stopServer };
}
