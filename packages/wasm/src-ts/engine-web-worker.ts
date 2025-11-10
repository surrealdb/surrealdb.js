import type { ConnectionOptions, SurrealWasmEngine } from "../wasm/surrealdb";
import { close, connect, execute, readNotifications } from "./engine-common";

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

export type Requests = {
    [R in keyof RequestHandlers]: (
        params: Parameters<RequestHandlers[R]>[0],
    ) => ReturnType<RequestHandlers[R]> extends Promise<infer R> ? R : void;
};

const handlers = [] as unknown as RequestHandlers;

self.addEventListener("message", async (event) => {
    const data = event.data as {
        [A in keyof RequestHandlers]: {
            request: A;
            promiseId: number;
            data: Parameters<RequestHandlers[A]>[0];
        };
    }[keyof RequestHandlers];

    try {
        const engine =
            "instanceId" in data.data ? engineInstances.get(data.data.instanceId) : undefined;
        const result = await handlers[data.request](data.data as never, engine);
        self.postMessage(
            {
                response: Response.RESPONSE,
                data: result,
                promiseId: data.promiseId,
            },
            result instanceof Uint8Array ? { transfer: [result.buffer as ArrayBuffer] } : undefined,
        );
    } catch (error) {
        self.postMessage({
            response: Response.ERROR,
            data: error,
            promiseId: data.promiseId,
        });
    }
});

let lastInstanceId = 0;
const engineInstances = new Map<number, SurrealWasmEngine>();

handlers[Request.CONNECT] = async (config: {
    url: string;
    options: ConnectionOptions | undefined;
}) => {
    const engine = await connect(config);

    const instanceId = ++lastInstanceId;
    engineInstances.set(instanceId, engine);

    return instanceId;
};

handlers[Request.READ_NOTIFICATIONS] = readNotifications({
    shouldKeepWorking: ({ instanceId }: { instanceId: number }) => engineInstances.has(instanceId),
    notify: (value) =>
        self.postMessage(
            { response: Response.NOTIFICATION, data: value },
            { transfer: [value.buffer as ArrayBuffer] },
        ),
});

handlers[Request.EXECUTE] = execute;

handlers[Request.CLOSE] = (context, engine) => {
    close(context, engine);
    engineInstances.delete(context.instanceId);
};

self.postMessage({ response: Response.READY });
