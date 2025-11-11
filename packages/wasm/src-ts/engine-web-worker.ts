import type { ConnectionOptions, SurrealWasmEngine } from "../wasm/surrealdb";
import { close, connect, execute, readNotifications } from "./engine-common";
import { Request, type RequestHandlers, Response } from "./engine-web-worker-contract";

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
