import type { ConnectionOptions, SurrealWasmEngine } from "../wasm/surrealdb";

export const Request = {
    CONNECT: 0,
    READ_NOTIFICATIONS: 1,
    EXECUTE: 2,
    CLOSE: 3,
} as const;
export type Request = (typeof Request)[keyof typeof Request];

export const Response = {
    READY: 0,
    RESPONSE: 1,
    NOTIFICATION: 2,
    ERROR: 3,
} as const;
export type Response = (typeof Response)[keyof typeof Response];

export type ResponseHandlers = {
    [Response.READY]: (promiseId: number) => void;
    [Response.ERROR]: (promiseId: number, data: Error) => void;
    [Response.RESPONSE]: (promiseId: number, data: unknown) => void;
    [Response.NOTIFICATION]: (promiseId: unknown, data: Uint8Array) => void;
};

export interface RequestHandlers {
    [Request.CONNECT]: (config: {
        url: string;
        options: ConnectionOptions | undefined;
    }) => Promise<number>;
    [Request.READ_NOTIFICATIONS]: (
        config: {
            instanceId: number;
        },
        engine: SurrealWasmEngine | undefined,
    ) => Promise<void>;
    [Request.EXECUTE]: (
        config: {
            instanceId: number;
            payload: Uint8Array;
        },
        engine: SurrealWasmEngine | undefined,
    ) => Promise<Uint8Array>;
    [Request.CLOSE]: (
        config: { instanceId: number },
        engine: SurrealWasmEngine | undefined,
    ) => void;
}
