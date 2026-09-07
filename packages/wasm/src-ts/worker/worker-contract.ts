import type { ConnectionOptions } from "@surrealdb/wasm-native";

export const RequestType = {
    CONNECT: "connect",
    EXECUTE: "execute",
    QUERY_STREAM: "queryStream",
    IMPORT_SQL: "importSql",
    EXPORT_SQL: "exportSql",
    CLOSE: "close",
} as const;

export type RequestType = (typeof RequestType)[keyof typeof RequestType];

export const ResponseType = {
    READY: "ready",
    RESPONSE: "response",
    NOTIFICATION: "notification",
    ERROR: "error",
} as const;

export type ResponseType = (typeof ResponseType)[keyof typeof ResponseType];

export interface ConnectRequest {
    url: string;
    options: ConnectionOptions | undefined;
}

export interface ExecuteRequest {
    payload: Uint8Array;
}

export interface QueryStreamRequest {
    payload: Uint8Array;
    /**
     * The channel the query's frames travel back through.
     *
     * A channel of its own rather than the request channel, so a stream's frames
     * neither queue behind other requests nor need correlating with one, and so
     * the reader can pace them. Transferred to the worker, which is why frames
     * cannot ride a transferred `ReadableStream` instead: streams are not
     * transferable in every runtime this package runs in, ports are.
     */
    port: MessagePort;
}

/** What a frame channel's reader asks of the worker. */
export type FrameRequest = { pull: true } | { cancel: true };

/** What the worker answers a {@link FrameRequest} with. */
export type FrameReply = { value: Uint8Array } | { done: true } | { error: Error };

export interface ImportSqlRequest {
    data: string;
}

export interface ExportSqlRequest {
    options: Uint8Array;
}

export type RequestData =
    | { type: typeof RequestType.CONNECT; data: ConnectRequest }
    | { type: typeof RequestType.EXECUTE; data: ExecuteRequest }
    | { type: typeof RequestType.QUERY_STREAM; data: QueryStreamRequest }
    | { type: typeof RequestType.IMPORT_SQL; data: ImportSqlRequest }
    | { type: typeof RequestType.EXPORT_SQL; data: ExportSqlRequest }
    | { type: typeof RequestType.CLOSE; data: undefined };

export type RequestMessage = RequestData & {
    id: string;
};

export interface ResponseMessage {
    id: string;
    type: typeof ResponseType.RESPONSE;
    data: unknown;
}

export interface ErrorMessage {
    id: string;
    type: typeof ResponseType.ERROR;
    error: Error;
}

export interface NotificationMessage {
    type: typeof ResponseType.NOTIFICATION;
    data: Uint8Array;
}

export interface ReadyMessage {
    type: typeof ResponseType.READY;
}

export type WorkerMessage = ResponseMessage | ErrorMessage | NotificationMessage | ReadyMessage;
