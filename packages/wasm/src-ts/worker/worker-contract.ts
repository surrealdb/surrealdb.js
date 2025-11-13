import type { ConnectionOptions } from "../../wasm/surrealdb";

export const RequestType = {
    CONNECT: "connect",
    EXECUTE: "execute",
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

export type RequestData =
    | { type: typeof RequestType.CONNECT; data: ConnectRequest }
    | { type: typeof RequestType.EXECUTE; data: ExecuteRequest }
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
