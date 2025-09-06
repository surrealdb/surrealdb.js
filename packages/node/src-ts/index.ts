import type { Engines } from "surrealdb";
import type { ConnectionOptions } from "../napi";
import { NodeEngine } from "./engine";

/**
 * Configure the `mem` and `rocksdb` Nodejs engines for the JavaScript SDK.
 *
 * While this package is called `@surrealdb/node`, it is also compatible with Bun and Deno.
 *
 * @param options Optional connection options to configure the Nodejs engines.
 * @example ```ts
 * import { createNodeEngines } from "@surrealdb/node";
 * import { Surreal } from "surrealdb";
 *
 * const db = new Surreal(createNodeEngines());
 * ```
 */
export const createNodeEngines = (options?: ConnectionOptions): Engines => ({
    mem: (ctx) => new NodeEngine(ctx, options),
    indxdb: (ctx) => new NodeEngine(ctx, options),
});

export * from "./engine";
