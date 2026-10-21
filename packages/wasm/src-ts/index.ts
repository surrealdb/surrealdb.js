import type { ConnectionOptions } from "@surrealdb/wasm-native";
import type { DriverContext, Engines } from "surrealdb";
import { WebAssemblyEngine } from "./engine";
import { LocalEngineBroker } from "./local/local-broker";
import { type WasmWorkerOptions, WorkerEngineBroker } from "./worker/worker-broker";

/**
 * Configure the `mem` WebAssembly engine for the JavaScript SDK, running on the main thread.
 *
 * Persistent browser stores are not offered here. They run only in a Web Worker,
 * so use {@link createWasmWorkerEngines} for `surrealkv://` and `indxdb://`. Connecting
 * to either scheme with these engines fails with an `UnsupportedEngineError`.
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
    };
};

/**
 * Configure the `mem`, `surrealkv` and `indxdb` WebAssembly engines to run inside a Web Worker
 * for the JavaScript SDK.
 *
 * `surrealkv` is the persistent browser store. `indxdb` is registered as a pass-through to the
 * same engine: the WebAssembly module applies the alias, and the SDK passes the URL on unchanged.
 * Persistent stores are only available through this function, not {@link createWasmEngines}.
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
        surrealkv: createEngine,
        indxdb: createEngine,
    };
};

export * from "./engine";
