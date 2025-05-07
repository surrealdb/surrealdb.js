import { afterAll } from "bun:test";
import { rm } from "node:fs/promises";
import type { Subprocess } from "bun";
import Surreal, {
	type AnyAuth,
	type PrepareFn,
	type ReconnectOptions,
} from "surrealdb";
import { SURREAL_BIND, SURREAL_PORT_UNREACHABLE, SURREAL_USER } from "./env.ts";
import { SURREAL_EXECUTABLE_PATH } from "./env.ts";
import { SURREAL_PASS } from "./env.ts";
import { SURREAL_DB } from "./env.ts";
import { SURREAL_NS } from "./env.ts";
import { SURREAL_PORT } from "./env.ts";

export type Protocol = "http" | "ws";
export const PROTOCOL: Protocol =
	process.env.SURREAL_PROTOCOL === "http" ? "http" : "ws";
export const VERSION_CHECK: boolean =
	process.env.SURREAL_VERSION_CHECK !== "false";

declare global {
	var surrealProc: number;
}

type PremadeAuth = "root" | "invalid" | "none";
export function createAuth(auth: PremadeAuth): AnyAuth | undefined {
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
			throw new Error("Invalid auth option");
	}
}

type CreateSurrealOptions = {
	protocol?: Protocol;
	auth?: PremadeAuth;
	reachable?: boolean;
	unselected?: boolean;
	reconnect?: boolean | Partial<ReconnectOptions>;
	prepare?: PrepareFn;
};

export async function setupServer(): Promise<{
	createSurreal: (options?: CreateSurrealOptions) => Promise<Surreal>;
	spawn: () => Promise<void>;
	kill: () => Promise<void>;
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
			stdout: "pipe",
			stderr: "pipe",
			stdin: "pipe",
		});

		await waitForHealth();
	}

	async function kill() {
		proc?.kill();
		await proc?.exited;
	}

	async function createSurreal({
		protocol,
		auth,
		reachable,
		unselected,
		reconnect,
		prepare,
	}: CreateSurrealOptions = {}) {
		protocol = protocol ? protocol : PROTOCOL;
		const surreal = new Surreal();
		const port = reachable === false ? SURREAL_PORT_UNREACHABLE : SURREAL_PORT;
		await surreal.connect(`${protocol}://127.0.0.1:${port}/rpc`, {
			namespace: unselected ? undefined : SURREAL_NS,
			database: unselected ? undefined : SURREAL_DB,
			auth: createAuth(auth ?? "root"),
			prepare,
			reconnect,
			versionCheck: VERSION_CHECK,
		});

		return surreal;
	}

	afterAll(async () => {
		await kill();
		await rm(folder, { recursive: true, force: true });
	});

	await spawn();

	return { createSurreal, spawn, kill };
}

function waitForHealth(): Promise<void> {
	// biome-ignore lint/suspicious/noAsyncPromiseExecutor: needed for the loop
	return new Promise<void>(async (resolve, reject) => {
		let failed = false;
		let healthy = false;
		while (!failed && !healthy) {
			await fetch(`http://127.0.0.1:${SURREAL_PORT}/health`)
				.then(() => {
					healthy = true;
					resolve();
				})
				.catch(() => new Promise((r) => setTimeout(r, 100)));
		}

		setTimeout(() => {
			failed = true;
			reject("Could not resolve health endpoint after 10 seconds.");
		});
	});
}
