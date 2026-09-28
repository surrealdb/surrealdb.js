import { SurrealWasmEngine } from "@surrealdb/wasm-native";
import { ConnectionUnavailableError } from "surrealdb";
import { initializeLibrary, readNotifications } from "../common";
import {
    type ConnectRequest,
    type ExecuteRequest,
    type ExportSqlRequest,
    type FrameReply,
    type FrameRequest,
    type ImportSqlRequest,
    type QueryStreamRequest,
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

/**
 * Open a streaming query and serve its frames over the request's channel.
 *
 * Returning is what tells the caller the query opened, so a failure from before
 * execution began — a denied capability, a parse error, an unknown transaction —
 * is reported as this request failing rather than as a frame.
 *
 * After that the channel answers one frame per request, so the reader's pace is
 * the query's pace. The module buffers a single frame, so a reader that stops
 * asking stops the scan, and one that cancels abandons the query.
 */
async function handleQueryStream(request: QueryStreamRequest): Promise<void> {
    if (!instance) {
        throw new ConnectionUnavailableError();
    }

    const reader = (await instance.query_stream(request.payload)).getReader();
    const port = request.port;

    // Pulls never overlap each other: the reader asks for the next frame only
    // once it has the previous. A cancel does overlap, though — it is sent as
    // soon as a consumer walks away, which can be while a read is still in
    // flight — so `closed` guards the port against the read that lands after.
    let closed = false;

    const shutdown = async () => {
        if (closed) return;
        closed = true;
        await reader.cancel().catch(() => {});
        port.close();
    };

    port.onmessage = async (event: MessageEvent) => {
        const message = event.data as FrameRequest;

        if ("cancel" in message) {
            await shutdown();
            return;
        }

        try {
            const { done, value } = await reader.read();

            if (closed) return;

            if (done) {
                closed = true;
                port.postMessage({ done: true } satisfies FrameReply);
                port.close();
                return;
            }

            port.postMessage({ value } satisfies FrameReply, [value.buffer as ArrayBuffer]);
        } catch (error) {
            if (closed) return;
            closed = true;
            port.postMessage({
                error: error instanceof Error ? error : new Error(String(error)),
            } satisfies FrameReply);
            port.close();
        }
    };
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

            case RequestType.QUERY_STREAM: {
                result = await handleQueryStream(message.data);
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
