import type { Engines } from "surrealdb";
import init, { type ConnectionOptions } from "../wasm/surrealdb";
import { WebAssemblyEngine } from "./engine";
import { WebAssemblyEngineBroker } from "./engine-broker";
import { WebAssemblyEngineWebWorkerBroker } from "./engine-web-worker-broker";

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
export const createWasmEngines = (options?: ConnectionOptions): Engines => {
    const broker = new WebAssemblyEngineBroker();
    return {
        mem: (ctx) => new WebAssemblyEngine(broker, ctx, options),
        indxdb: (ctx) => new WebAssemblyEngine(broker, ctx, options),
    };
};

/**
 * Configure the `mem` and `indxdb` WebAssembly WebWorker engines for the JavaScript SDK.
 *
 * @param options Optional connection options to configure the WebAssembly engines.
 * @example
 * ```ts
 * import { Surreal, createRemoteEngines } from "surrealdb";
 * import { createWasmWebWrokerEngines } from "@surrealdb/wasm";
 *
 * const db = new Surreal({
 *     engines: {
 *         ...createRemoteEngines(),
 *         ...createWasmWebWrokerEngines(),
 *     },
 * });
 * ```
 */
export const createWasmWebWrokerEngines = (options?: ConnectionOptions): Engines => {
    const broker = new WebAssemblyEngineWebWorkerBroker();
    return {
        mem: (ctx) => new WebAssemblyEngine(broker, ctx, options),
        indxdb: (ctx) => new WebAssemblyEngine(broker, ctx, options),
    };
};

export * from "./engine";
