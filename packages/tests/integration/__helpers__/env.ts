import getPort from "get-port";
import type { Protocol } from "./surreal";

const port = await getPort();
if (typeof port !== "number") throw new Error("Could not claim port");

export const SURREAL_EXECUTABLE_PATH: string =
    process.env.SURREAL_EXECUTABLE_PATH || "/usr/local/bin/surreal";
export const SURREAL_PROTOCOL: Protocol =
    import.meta.env.SURREAL_PROTOCOL === "http" ? "http" : "ws";
export const SURREAL_PORT: string = port.toString();
export const SURREAL_BIND: string = `0.0.0.0:${SURREAL_PORT}`;
export const SURREAL_USER = "root";
export const SURREAL_PASS = "root";
export const SURREAL_NS = "test";
export const SURREAL_DB = "test";
