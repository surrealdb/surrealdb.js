import type { Engines } from "surrealdb";
import init, { type ConnectionOptions } from "../wasm/surrealdb";
import { WebAssemblyEngine } from "./engine";

const wasmUrl = new URL("../wasm/surrealdb_bg.wasm", import.meta.url);
const wasmCode = await (await fetch(wasmUrl)).arrayBuffer();

await init(wasmCode);

/**
 * Configure the `mem` and `indxdb` WebAssembly engines for the JavaScript SDK.
 *
 * @param options Optional connection options to configure the WebAssembly engines.
 * @example
 * ```ts
 * import { Surreal, createRemoteEngines } from "surrealdb";
 * import { createWasmEngines } from "@surrealdb/wasm";
 *
 * const db = new Surreal({
 *     engines: {
 *         ...createRemoteEngines(),
 *         ...createWasmEngines(),
 *     },
 * });
 * ```
 */
export const createWasmEngines = (options?: ConnectionOptions): Engines => ({
    mem: (ctx) => new WebAssemblyEngine(ctx, options),
    indxdb: (ctx) => new WebAssemblyEngine(ctx, options),
});

export * from "./engine";
