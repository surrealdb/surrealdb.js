import { ConnectionUnavailableError } from "surrealdb";
import { SurrealWasmEngine } from "../../wasm/surrealdb";
import { initializeLibrary, readNotifications } from "../common";
import {
    type ConnectRequest,
    type ExecuteRequest,
    type RequestMessage,
    RequestType,
    ResponseType,
} from "./worker-contract";

let instance: SurrealWasmEngine | undefined;
let cancelNotifications: (() => void) | undefined;
let abortController: AbortController | undefined;

async function handleConnect(request: ConnectRequest): Promise<void> {
    cancelNotifications?.();
    abortController?.abort();
    instance?.free();

    await initializeLibrary();

    instance = await SurrealWasmEngine.connect(request.url, request.options);

    abortController = new AbortController();
    cancelNotifications = readNotifications(
        instance,
        (data) => {
            self.postMessage(
                { type: ResponseType.NOTIFICATION, data },
                { transfer: [data.buffer as ArrayBuffer] },
            );
        },
        abortController.signal,
    );
}

async function handleExecute(request: ExecuteRequest): Promise<Uint8Array> {
    if (!instance) {
        throw new ConnectionUnavailableError();
    }

    return instance.execute(request.payload);
}

function handleClose(): void {
    cancelNotifications?.();
    cancelNotifications = undefined;
    abortController?.abort();
    abortController = undefined;
    instance?.free();
    instance = undefined;
}

// Subscribe to incoming requests
self.addEventListener("message", async (event) => {
    const message = event.data as RequestMessage;

    try {
        let result: unknown;

        switch (message.type) {
            case RequestType.CONNECT: {
                result = await handleConnect(message.data);
                break;
            }

            case RequestType.EXECUTE: {
                const executeRequest = message.data;
                result = await handleExecute(executeRequest);
                break;
            }

            case RequestType.CLOSE: {
                handleClose();
                result = undefined;
                break;
            }
        }

        self.postMessage(
            {
                id: message.id,
                type: ResponseType.RESPONSE,
                data: result,
            },
            result instanceof Uint8Array ? { transfer: [result.buffer as ArrayBuffer] } : undefined,
        );
    } catch (error) {
        self.postMessage({
            id: message.id,
            type: ResponseType.ERROR,
            error: error instanceof Error ? error : new Error(String(error)),
        });
    }
});

// Signal that the worker is ready
self.postMessage({ type: ResponseType.READY });
