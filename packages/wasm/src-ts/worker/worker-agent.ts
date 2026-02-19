import { ConnectionUnavailableError } from "surrealdb";
import { SurrealWasmEngine } from "../../wasm/surrealdb";
import { initializeLibrary, readNotifications } from "../common";
import {
    type ConnectRequest,
    type ExecuteRequest,
    type ExportSqlRequest,
    type ImportSqlRequest,
    type RequestMessage,
    RequestType,
    ResponseType,
} from "./worker-contract";

let instance: SurrealWasmEngine | undefined;
let cancelNotifications: (() => Promise<void>) | undefined;
let abortController: AbortController | undefined;

async function handleConnect(request: ConnectRequest): Promise<void> {
    abortController?.abort();
    await cancelNotifications?.();
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

async function handleImportSql(request: ImportSqlRequest): Promise<void> {
    if (!instance) {
        throw new ConnectionUnavailableError();
    }

    return instance.import(request.data);
}

async function handleExportSql(request: ExportSqlRequest): Promise<string> {
    if (!instance) {
        throw new ConnectionUnavailableError();
    }

    return instance.export(request.options);
}

async function handleClose(): Promise<void> {
    abortController?.abort();
    await cancelNotifications?.();
    cancelNotifications = undefined;
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
                result = await handleExecute(message.data);
                break;
            }

            case RequestType.IMPORT_SQL: {
                result = await handleImportSql(message.data);
                break;
            }

            case RequestType.EXPORT_SQL: {
                result = await handleExportSql(message.data);
                break;
            }

            case RequestType.CLOSE: {
                await handleClose();
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
