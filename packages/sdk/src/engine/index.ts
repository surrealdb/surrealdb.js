import type { Engines } from "../types";
import { HttpEngine } from "./http";
import { WebSocketEngine } from "./websocket";

export { HttpEngine } from "./http";
export { JsonEngine } from "./json";
export { WebSocketEngine } from "./websocket";

/**
 * Configure the `ws`, `wss`, `http`, and `https` remote engines for the JavaScript SDK.
 *
 * When engines are not explicitly configured, the JavaScript SDK will configure the
 * remote engines by default.
 *
 * @example
 * ```ts
 * import { Surreal, createRemoteEngines } from "surrealdb";
 *
 * const db = new Surreal({
 *     engines: createRemoteEngines(),
 * });
 * ```
 */
export const createRemoteEngines = (): Engines => ({
    ws: (ctx) => new WebSocketEngine(ctx),
    wss: (ctx) => new WebSocketEngine(ctx),
    http: (ctx) => new HttpEngine(ctx),
    https: (ctx) => new HttpEngine(ctx),
});
