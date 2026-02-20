import type { DriverContext, Engines } from "surrealdb";
import type { ConnectionOptions } from "../wasm/surrealdb";
import { WebAssemblyEngine } from "./engine";
import { LocalEngineBroker } from "./local/local-broker";
import { type WasmWorkerOptions, WorkerEngineBroker } from "./worker/worker-broker";

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
    const createEngine = (ctx: DriverContext) =>
        new WebAssemblyEngine(new LocalEngineBroker(), ctx, options);

    return {
        mem: createEngine,
        indxdb: createEngine,
    };
};

/**
 * Configure the `mem` and `indxdb` WebAssembly WebWorker engines for the JavaScript SDK.
 *
 * @param options Optional connection options to configure the WebAssembly engines.
 * @example
 * ```ts
 * import { Surreal, createRemoteEngines } from "surrealdb";
 * import { createWasmWorkerEngines } from "@surrealdb/wasm";
 *
 * const db = new Surreal({
 *     engines: {
 *         ...createRemoteEngines(),
 *         ...createWasmWorkerEngines(),
 *     },
 * });
 * ```
 */
export const createWasmWorkerEngines = (options?: WasmWorkerOptions): Engines => {
    const createEngine = (ctx: DriverContext) =>
        new WebAssemblyEngine(new WorkerEngineBroker(), ctx, options);

    return {
        mem: createEngine,
        indxdb: createEngine,
    };
};

export * from "./engine";
