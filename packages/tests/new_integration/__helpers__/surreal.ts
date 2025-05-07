import { afterAll } from "bun:test";
import { rm } from "node:fs/promises";
import type { Subprocess } from "bun";
import { Surreal, type AnyAuth, type ReconnectOptions } from "surrealdb";
import { SURREAL_BIND, SURREAL_PORT_UNREACHABLE, SURREAL_USER } from "./env.ts";
import { SURREAL_EXECUTABLE_PATH } from "./env.ts";
import { SURREAL_PASS } from "./env.ts";
import { SURREAL_DB } from "./env.ts";
import { SURREAL_NS } from "./env.ts";
import { SURREAL_PORT } from "./env.ts";

export type Protocol = "http" | "ws";
export type PremadeAuth = "root" | "invalid" | "none";
export type IdleSurreal = {
	surreal: Surreal;
	connect: () => Promise<true>;
};

export const DEFAULT_PROTOCOL: Protocol =
	process.env.SURREAL_PROTOCOL === "http" ? "http" : "ws";

declare global {
	var surrealProc: number;
}

export function createAuth(auth: PremadeAuth | AnyAuth): AnyAuth | undefined {
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
		case "none": {
			return undefined;
		}
		default:
			return auth;
	}
}

type CreateSurrealOptions = {
	protocol?: Protocol;
	auth?: PremadeAuth;
	reachable?: boolean;
	unselected?: boolean;
	reconnect?: boolean | Partial<ReconnectOptions>;
};

export async function setupServer(): Promise<{
	spawn: () => Promise<void>;
	kill: () => Promise<void>;
	createSurreal: (options?: CreateSurrealOptions) => Promise<Surreal>;
	createIdleSurreal: (options?: CreateSurrealOptions) => IdleSurreal;
}> {
	const folder = `test.db/${Math.random().toString(36).substring(2, 7)}`;
	let proc: undefined | Subprocess = undefined;

	async function spawn() {
		proc = Bun.spawn([SURREAL_EXECUTABLE_PATH, "start", `rocksdb:${folder}`], {
			env: {
				SURREAL_BIND,
				SURREAL_USER,
				SURREAL_PASS,
			},
		});

		await waitForHealth();
	}

	async function kill() {
		proc?.kill();
		await Bun.sleep(1000);
	}

	function createIdleSurreal({
		protocol,
		auth,
		reachable,
		unselected,
		reconnect,
	}: CreateSurrealOptions = {}) {
		const surreal = new Surreal();
		const port = reachable === false ? SURREAL_PORT_UNREACHABLE : SURREAL_PORT;

		const connect = () => {
			return surreal.connect(
				`${protocol ?? DEFAULT_PROTOCOL}://127.0.0.1:${port}/rpc`,
				{
					namespace: unselected ? undefined : SURREAL_NS,
					database: unselected ? undefined : SURREAL_DB,
					authentication: createAuth(auth ?? "root"),
					reconnect,
				},
			);
		};

		return { surreal, connect } as IdleSurreal;
	}

	async function createSurreal(opts: CreateSurrealOptions = {}) {
		const { surreal, connect } = createIdleSurreal(opts);
		await connect();
		return surreal;
	}

	afterAll(async () => {
		await kill();
		await rm(folder, { recursive: true, force: true });
	});

	await spawn();

	return { createSurreal, createIdleSurreal, spawn, kill };
}

async function waitForHealth(): Promise<void> {
	const startAt = Date.now();

	while (Date.now() - startAt < 10_000) {
		try {
			const response = await fetch(`http://127.0.0.1:${SURREAL_PORT}/health`);

			if (response.ok) {
				return;
			}
		} catch {
			await new Promise((r) => setTimeout(r, 100));
		}
	}

	throw new Error("Could not resolve health endpoint after 10 seconds.");
}
