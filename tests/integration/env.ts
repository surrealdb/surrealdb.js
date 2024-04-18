import { getAvailablePortSync } from "https://deno.land/x/port@1.0.0/mod.ts"

const port = getAvailablePortSync();
if (typeof port != 'number') throw new Error("Could not claim port");

export const SURREAL_PORT = port.toString();
export const SURREAL_BIND = `0.0.0.0:${SURREAL_PORT}`;
export const SURREAL_USER = "root";
export const SURREAL_PASS = "root";
export const SURREAL_NS = "test";
export const SURREAL_DB = "test";

