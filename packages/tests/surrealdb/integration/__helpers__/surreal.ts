import { rm } from "node:fs/promises";
import { type Subprocess, sleep } from "bun";
import getPort from "get-port";
import { satisfies } from "semver";
import {
    applyDiagnostics,
    CborCodec,
    type ConnectOptions,
    createRemoteEngines,
    type Diagnostic,
    type DriverOptions,
    type Engines,
    type ReconnectOptions,
    Surreal,
    type SystemAuth,
} from "surrealdb";
import {
    SURREAL_BACKEND,
    SURREAL_BIND,
    SURREAL_DB,
    SURREAL_EXECUTABLE_PATH,
    SURREAL_NS,
    SURREAL_PASS,
    SURREAL_PORT,
    SURREAL_PROTOCOL,
    SURREAL_USER,
} from "./env.ts";

export type Protocol = "http" | "ws" | "mem";
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
 * For embedded engines (wasm/node), reads the version set on globalThis by the preload script.
 * For remote engines, spawns the surreal binary to check the version.
 */
const VERSION_REGEX = /(\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?)/;

export async function requestVersion(): Promise<{
    version: string;
    is2x: boolean;
    /** Whether the version has the features of 3.0, which every later version, 4.0 included, keeps */
    is3x: boolean;
    /** Whether a RETURN at the top level of a transaction is a value statement rather than an early exit (3.4.0 and later) */
    returnIsAValue: boolean;
    /** Whether the version reports a transaction conflict as a structured error (3.1.0 and later) */
    structuredConflicts: boolean;
    /**
     * Whether a field which fails to coerce is reported as a Validation error rather than an
     * Internal one (3.3.0 and later, 4.0 included).
     *
     * Checked against 3.0.0, which reports Internal, and 3.3.4 and 4.0 nightly, which report
     * Validation with `details.kind` of `InvalidRequest`; 3.1 and 3.2 were not checked.
     */
    coercionIsValidation: boolean;
}> {
    let output: string;

    const cachedVersion = (globalThis as GlobalThis).surrealVersion;
    if (cachedVersion) {
        output = cachedVersion;
    } else {
        const proc = Bun.spawn([SURREAL_EXECUTABLE_PATH, "version"]);
        output = await Bun.readableStreamToText(proc.stdout);
    }

    const match = output.match(VERSION_REGEX);
    if (!match) {
        throw new Error(`Could not parse SurrealDB version from output: ${output}`);
    }

    const version = match[1];
    const is2x = satisfies(version, ">=2.0.0-0 <3.0.0-0", { includePrerelease: true });
    const is3x = satisfies(version, ">=3.0.0-0", { includePrerelease: true });
    const returnIsAValue = satisfies(version, ">=3.4.0-0", { includePrerelease: true });
    const structuredConflicts = satisfies(version, ">=3.1.0-0", {
        includePrerelease: true,
    });
    const coercionIsValidation = satisfies(version, ">=3.3.0-0", {
        includePrerelease: true,
    });

    return {
        version,
        is2x,
        is3x,
        returnIsAValue,
        structuredConflicts,
        coercionIsValidation,
    };
}

let cbor2: Promise<boolean> | undefined;

/**
 * Whether a connection over the protocol under test speaks `cbor.2` (SurrealDB 4.0): the
 * server binary must speak it, and over WebSocket the runtime must be able to offer it. It starts a server of its own, so that it can be awaited where tests are
 * declared, before the shared server is up. Always false for the embedded engines.
 */
export function speaksCbor2(): Promise<boolean> {
    cbor2 ??= (async () => {
        if (SURREAL_BACKEND !== "remote") return false;

        const port = await getPort();
        const probe = Bun.spawn(
            [SURREAL_EXECUTABLE_PATH, "start", "--bind", `127.0.0.1:${port}`, "memory"],
            { stdout: "ignore", stderr: "ignore" },
        );

        try {
            const startAt = Date.now();

            while (Date.now() - startAt < 10_000) {
                const healthy = await fetch(`http://127.0.0.1:${port}/health`).then(
                    (response) => response.ok,
                    () => false,
                );
                if (healthy) break;
                await sleep(100);
            }

            // Asked over HTTP: some WebSocket implementations cannot offer more than one subprotocol
            const response = await fetch(`http://127.0.0.1:${port}/rpc`, {
                method: "POST",
                body: new CborCodec({}).encode({ id: "1", method: "version" }),
                headers: { "Content-Type": "application/cbor", Accept: "application/cbor; v=2" },
            });
            await response.arrayBuffer();

            if (!/v=2/.test(response.headers.get("Content-Type") ?? "")) return false;
            if (SURREAL_PROTOCOL !== "ws") return true;

            // Over WebSocket the SDK falls back to plain cbor where the runtime cannot offer
            // more than one subprotocol, as Bun 1.2 cannot
            return await new Promise<boolean>((resolve) => {
                const socket = new WebSocket(`ws://127.0.0.1:${port}/rpc`, ["cbor.2", "cbor"]);
                socket.onopen = () => {
                    resolve(socket.protocol === "cbor.2");
                    socket.close();
                };
                socket.onclose = () => resolve(false);
            });
        } finally {
            probe.kill();
            await probe.exited;
        }
    })();

    return cbor2;
}

/**
 * Spawn a new SurrealDB server. No-op when SURREAL_BACKEND is "wasm" or "node".
 */
export async function spawnServer(): Promise<void> {
    if (SURREAL_BACKEND !== "remote") return;
    if (folder || server) {
        throw new Error("Server already running");
    }

    console.log("Spawning server...");

    const proc = Bun.spawn([SURREAL_EXECUTABLE_PATH, "version"]);
    const versionOutput = await Bun.readableStreamToText(proc.stdout);
    (globalThis as GlobalThis).surrealVersion = versionOutput;

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
 * Kill an active SurrealDB server. No-op when SURREAL_BACKEND is "wasm" or "node".
 */
export async function killServer(): Promise<void> {
    if (SURREAL_BACKEND !== "remote") return;
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
 * Respawn an active SurrealDB server. No-op when SURREAL_BACKEND is "wasm" or "node".
 */
export async function respawnServer(): Promise<void> {
    if (SURREAL_BACKEND !== "remote") return;
    await killServer();
    await spawnServer();
}

type GlobalThis = typeof globalThis & {
    embeddedEngines?: Engines;
    surrealVersion?: string;
};

let cachedEngines: Engines | null = null;

export async function getEngines(wrapDiagnostics?: (d: Diagnostic) => void): Promise<Engines> {
    if (!cachedEngines) {
        const engines = (globalThis as GlobalThis).embeddedEngines;
        if (engines) {
            console.log("Creating engines from globalThis");
            cachedEngines = engines;
        } else {
            cachedEngines = createRemoteEngines();
        }
    }
    return wrapDiagnostics ? applyDiagnostics(cachedEngines, wrapDiagnostics) : cachedEngines;
}

function getConnectUrl(): string {
    if (SURREAL_PROTOCOL === "mem") {
        return "mem://";
    }
    return `${SURREAL_PROTOCOL}://127.0.0.1:${SURREAL_PORT}/rpc`;
}

/**
 * Create an idle SurrealDB connection.
 */
export async function createIdleSurreal({
    auth,
    unselected,
    reconnect,
    driverOptions,
    printDiagnostics,
}: CreateSurrealOptions = {}) {
    const engines = await getEngines(printDiagnostics ? printDiagnostic : undefined);

    const surreal = new Surreal({
        ...driverOptions,
        engines: {
            ...engines,
            ...driverOptions?.engines,
        },
    });

    connections.push(surreal);

    const connect = (custom?: ConnectOptions) => {
        const defaultAuth: PremadeAuth = SURREAL_BACKEND === "remote" ? "root" : "none";
        return surreal.connect(getConnectUrl(), {
            namespace: unselected ? undefined : SURREAL_NS,
            database: unselected ? undefined : SURREAL_DB,
            authentication: createAuth(auth ?? defaultAuth),
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
    const { surreal, connect } = await createIdleSurreal(opts);
    await connect();
    return surreal;
}
