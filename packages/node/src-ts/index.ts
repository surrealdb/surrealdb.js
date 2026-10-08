import { type ConnectionOptions, SurrealNodeEngine } from "@surrealdb/node-native";
import type { Engines } from "surrealdb";
import { NodeEngine } from "./engine";

/**
 * Configure the `mem`, `rocksdb`, `surrealkv`, and `surrealkv+versioned` Nodejs engines for the JavaScript SDK.
 *
 * While this package is called `@surrealdb/node`, it is also compatible with Bun and Deno.
 *
 * @param options Optional connection options to configure the Nodejs engines.
 * @example
 * ```ts
 * import { Surreal, createRemoteEngines } from "surrealdb";
 * import { createNodeEngines } from "@surrealdb/node";
 *
 * const db = new Surreal({
 *     engines: {
 *         ...createRemoteEngines(),
 *         ...createNodeEngines(),
 *     },
 * });
 * ```
 */
export const createNodeEngines = (options?: ConnectionOptions): Engines => ({
    mem: (ctx) => new NodeEngine(ctx, options),
    rocksdb: (ctx) => new NodeEngine(ctx, options),
    surrealkv: (ctx) => new NodeEngine(ctx, options),
    "surrealkv+versioned": (ctx) => new NodeEngine(ctx, options),
});

/**
 * The version of the SurrealDB engine embedded in this package, as reported by
 * the native addon. This is the engine the embedded `mem`, `rocksdb` and
 * `surrealkv` endpoints run, and is independent of the version of `@surrealdb/node`.
 *
 * @example
 * ```ts
 * import { engineVersion } from "@surrealdb/node";
 *
 * console.log(engineVersion()); // e.g. "3.3.1"
 * ```
 */
export const engineVersion = (): string => SurrealNodeEngine.version();

export * from "./engine";
