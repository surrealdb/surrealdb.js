import { rm } from "node:fs/promises";
import { type Subprocess, sleep } from "bun";
import {
    applyDiagnostics,
    type ConnectOptions,
    createRemoteEngines,
    type Diagnostic,
    type DriverOptions,
    type ReconnectOptions,
    Surreal,
    type SystemAuth,
} from "surrealdb";
import {
    SURREAL_BIND,
    SURREAL_DB,
    SURREAL_EXECUTABLE_PATH,
    SURREAL_NS,
    SURREAL_PASS,
    SURREAL_PORT,
    SURREAL_PROTOCOL,
    SURREAL_USER,
} from "./env.ts";

export type Protocol = "http" | "ws";
export type PremadeAuth = "root" | "invalid" | "none";
export type IdleSurreal = {
    surreal: Surreal;
    connect: (custom?: ConnectOptions) => Promise<true>;
};

export const VERSION_CHECK: boolean = import.meta.env.SURREAL_VERSION_CHECK !== "false";

type CreateSurrealOptions = {
    auth?: PremadeAuth;
    unselected?: boolean;
    reconnect?: boolean | Partial<ReconnectOptions>;
    driverOptions?: DriverOptions;
    printDiagnostics?: boolean;
};

let folder: undefined | string;
let server: undefined | Subprocess;

export const connections: Surreal[] = [];

/**
 * Print a formatted diagnostic message.
 */
export function printDiagnostic({ key, type, phase, ...other }: Diagnostic): void {
    const keyString = key.toString();
    const keySuffix = keyString.slice(keyString.lastIndexOf("-") + 1);

    let line = `[${keySuffix}] ${type}:${phase}`;

    if (phase === "progress" || phase === "after") {
        line += ` ${JSON.stringify(other)}`;
    }

    console.log(line);
}

/**
 * Create testing authentication.
 */
export function createAuth(auth: PremadeAuth | SystemAuth): SystemAuth | undefined {
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

/**
 * Request the version of the SurrealDB server.
 */
export async function requestVersion(): Promise<string> {
    const proc = Bun.spawn([SURREAL_EXECUTABLE_PATH, "version"]);
    const version = await Bun.readableStreamToText(proc.stdout);
    console.log("version raw", version);

    return version
        .replace(/^surrealdb-/, "")
        .slice(0, version.indexOf(" "))
        .trim();
}

/**
 * Spawn a new SurrealDB server.
 */
export async function spawnServer(): Promise<void> {
    if (folder || server) {
        throw new Error("Server already running");
    }

    console.log("Spawning server...");

    folder = `test.db/${Math.random().toString(36).substring(2, 7)}`;
    server = Bun.spawn([SURREAL_EXECUTABLE_PATH, "start", `rocksdb:${folder}`], {
        stdout: "inherit",
        stderr: "inherit",
        env: {
            SURREAL_BIND,
            SURREAL_USER,
            SURREAL_PASS,
            SURREAL_CAPS_ALLOW_EXPERIMENTAL: "*",
        },
    });

    const startAt = Date.now();

    while (Date.now() - startAt < 10_000) {
        try {
            const response = await fetch(`http://127.0.0.1:${SURREAL_PORT}/health`);

            if (response.ok) {
                console.log("Server spawned successfully");
                return;
            }
        } catch {
            await sleep(100);
        }
    }

    throw new Error("Could not resolve health endpoint after 10 seconds.");
}

/**
 * Kill an active SurrealDB server.
 */
export async function killServer(): Promise<void> {
    if (!folder || !server) {
        throw new Error("Server not running");
    }

    console.log("Killing server...");

    server.kill();

    await sleep(1000);
    await rm(folder, { recursive: true, force: true });

    folder = undefined;
    server = undefined;

    console.log("Server killed");
}

/**
 * Respawn an active SurrealDB server.
 */
export async function respawnServer(): Promise<void> {
    await killServer();
    await spawnServer();
}

/**
 * Create an idle SurrealDB connection.
 */
export function createIdleSurreal({
    auth,
    unselected,
    reconnect,
    driverOptions,
    printDiagnostics,
}: CreateSurrealOptions = {}) {
    const engines = printDiagnostics
        ? applyDiagnostics(createRemoteEngines(), printDiagnostic)
        : createRemoteEngines();

    const surreal = new Surreal({
        ...driverOptions,
        engines: {
            ...engines,
            ...driverOptions?.engines,
        },
    });

    surreal.subscribe("connected", (version) => {
        console.log("connected to version: ", version);
    });

    connections.push(surreal);

    const connect = (custom?: ConnectOptions) => {
        return surreal.connect(`${SURREAL_PROTOCOL}://127.0.0.1:${SURREAL_PORT}/rpc`, {
            namespace: unselected ? undefined : SURREAL_NS,
            database: unselected ? undefined : SURREAL_DB,
            authentication: createAuth(auth ?? "root"),
            reconnect,
            ...custom,
        });
    };

    return { surreal, connect } as IdleSurreal;
}

/**
 * Create a new SurrealDB connection.
 */
export async function createSurreal(opts: CreateSurrealOptions = {}) {
    const { surreal, connect } = createIdleSurreal(opts);
    await connect();
    return surreal;
}
