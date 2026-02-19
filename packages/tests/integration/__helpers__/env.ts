import getPort from "get-port";
import type { Protocol } from "./surreal";

const port = await getPort();
if (typeof port !== "number") throw new Error("Could not claim port");

/** "remote" = connect to spawned SurrealDB server; "wasm" | "node" = embedded in-process */
export const SURREAL_BACKEND: "remote" | "wasm" | "node" =
    (process.env.SURREAL_BACKEND as "remote" | "wasm" | "node") ?? "remote";

export const SURREAL_EXECUTABLE_PATH: string =
    process.env.SURREAL_EXECUTABLE_PATH || Bun.which("surreal") || "/usr/local/bin/surreal";
export const SURREAL_PROTOCOL: Protocol =
    SURREAL_BACKEND === "wasm" || SURREAL_BACKEND === "node"
        ? "mem"
        : import.meta.env.SURREAL_PROTOCOL === "http"
          ? "http"
          : "ws";
export const SURREAL_PORT: string = port.toString();
export const SURREAL_BIND: string = `0.0.0.0:${SURREAL_PORT}`;
export const SURREAL_USER = "root";
export const SURREAL_PASS = "root";
export const SURREAL_NS = "test";
export const SURREAL_DB = "test";
