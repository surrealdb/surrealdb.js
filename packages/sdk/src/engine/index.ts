import type { Engines } from "../types";
import { type DiagnosticsCallback, DiagnosticsEngine } from "./diagnostics";
import { HttpEngine } from "./http";
import { WebSocketEngine } from "./websocket";

export { HttpEngine } from "./http";
export { RpcEngine } from "./rpc";
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

/**
 * This utility allows you to wrap engines and listen to internal communication
 * within the SDK. Each operation is wrapped in a diagnostic event and emitted to the
 * provided callback.
 *
 * Note that use of this utility is discouraged in production environments as it may
 * hinder performance and is considered unstable, meaning diagnostic events may change between versions.
 *
 * @param engines The engine implementations to wrap.
 * @param callback The callback to emit diagnostic events to.
 * @returns The wrapped engine implementations.
 */
export const applyDiagnostics = (engines: Engines, callback: DiagnosticsCallback): Engines => {
    return Object.fromEntries(
        Object.entries(engines).map(([key, factory]) => [
            key,
            (ctx) => new DiagnosticsEngine(factory(ctx), callback),
        ]),
    );
};
