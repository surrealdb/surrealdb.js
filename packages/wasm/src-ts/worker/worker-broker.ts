import type { ConnectionOptions } from "@surrealdb/wasm-native";
import { ConnectionUnavailableError } from "surrealdb";
import type { EngineBroker } from "../common";
import {
    type FrameReply,
    type FrameRequest,
    RequestType,
    ResponseType,
    type WorkerMessage,
} from "./worker-contract";

export interface WasmWorkerOptions extends ConnectionOptions {
    createWorker?: () => Worker;
}

type PromiseResolver<T> = {
    resolve: (value: T) => void;
    reject: (error: Error) => void;
};

/**
 * Correlates a reply with the request that asked for it.
 *
 * Only has to be unique among the requests one broker has outstanding to one
 * worker, which is why it is a counter of its own rather than the SDK's: these
 * ids never leave the pair.
 */
let nextRequestId = 0;

/**
 * The frames of one query, pulled over `port` a frame at a time.
 *
 * Nothing arrives on the channel until this asks for it, so the reader's pace is
 * the query's pace rather than the worker's: the next frame is requested only
 * once the previous one has been taken. Cancelling asks the worker to abandon the
 * query, which is what a consumer walking away amounts to.
 */
function frameStream(port: MessagePort): ReadableStream<Uint8Array> {
    return new ReadableStream<Uint8Array>({
        pull(controller) {
            return new Promise<void>((resolve, reject) => {
                port.onmessage = (event: MessageEvent) => {
                    const reply = event.data as FrameReply;

                    if ("error" in reply) {
                        port.close();
                        reject(reply.error);
                        return;
                    }

                    if ("done" in reply) {
                        port.close();
                        controller.close();
                    } else {
                        controller.enqueue(reply.value);
                    }

                    resolve();
                };

                port.postMessage({ pull: true } satisfies FrameRequest);
            });
        },
        cancel() {
            port.postMessage({ cancel: true } satisfies FrameRequest);
            port.close();
        },
    });
}

export class WorkerEngineBroker implements EngineBroker {
    #worker: Worker | undefined;
    #ready: Promise<void> = Promise.resolve();
    #markReady: (() => void) | undefined;
    #promiseResolvers = new Map<string, PromiseResolver<unknown>>();
    #handleNotification: ((data: Uint8Array) => void) | undefined;

    get isConnected() {
        return !!this.#worker;
    }

    async connect(
        url: string,
        options: WasmWorkerOptions | undefined,
        onNotification: (data: Uint8Array) => void,
    ) {
        this.#handleNotification = onNotification;
        this.#worker =
            options?.createWorker?.() ??
            new Worker(new URL(/* @vite-ignore */ "./worker-agent.mjs", import.meta.url), {
                type: "module",
            });
        this.#ready = new Promise<void>((resolve) => {
            this.#markReady = resolve;
        });

        this.#worker.addEventListener("message", (event) => {
            this.#handleMessage(event.data as WorkerMessage);
        });

        await this.#send({
            type: RequestType.CONNECT,
            data: {
                url,
                options: {
                    ...options,
                    createWorker: undefined,
                },
            },
        });
    }

    execute(payload: Uint8Array): Promise<Uint8Array> {
        if (!this.#worker) {
            throw new ConnectionUnavailableError();
        }

        return this.#send<Uint8Array>(
            {
                type: RequestType.EXECUTE,
                data: { payload },
            },
            [payload.buffer as ArrayBuffer],
        );
    }

    async queryStream(payload: Uint8Array): Promise<ReadableStream<Uint8Array>> {
        if (!this.#worker) {
            throw new ConnectionUnavailableError();
        }

        const { port1, port2 } = new MessageChannel();

        // Resolves once the query has opened, so a failure from before execution
        // began rejects here rather than arriving as a frame, and a stream is
        // only handed out for a query that is running.
        await this.#send<void>(
            {
                type: RequestType.QUERY_STREAM,
                data: { payload, port: port2 },
            },
            [payload.buffer as ArrayBuffer, port2],
        );

        return frameStream(port1);
    }

    async importSql(data: string): Promise<void> {
        if (!this.#worker) {
            throw new ConnectionUnavailableError();
        }

        return this.#send<void>({ type: RequestType.IMPORT_SQL, data: { data } });
    }

    async exportSql(options: Uint8Array): Promise<string> {
        if (!this.#worker) {
            throw new ConnectionUnavailableError();
        }

        return this.#send<string>({ type: RequestType.EXPORT_SQL, data: { options } }, [
            options.buffer as ArrayBuffer,
        ]);
    }

    async close() {
        if (this.#worker) {
            await this.#send<void>({
                type: RequestType.CLOSE,
                data: undefined,
            });
        }

        this.#worker?.terminate();
        this.#worker = undefined;
        this.#promiseResolvers.clear();
        this.#handleNotification = undefined;
        this.#ready = Promise.resolve();
        this.#markReady = undefined;
    }

    #handleMessage(message: WorkerMessage) {
        switch (message.type) {
            case ResponseType.READY: {
                this.#markReady?.();
                break;
            }

            case ResponseType.RESPONSE: {
                const resolver = this.#promiseResolvers.get(message.id);
                if (resolver) {
                    this.#promiseResolvers.delete(message.id);
                    resolver.resolve(message.data);
                }
                break;
            }

            case ResponseType.ERROR: {
                const resolver = this.#promiseResolvers.get(message.id);
                if (resolver) {
                    this.#promiseResolvers.delete(message.id);
                    resolver.reject(message.error);
                }
                break;
            }

            case ResponseType.NOTIFICATION: {
                this.#handleNotification?.(message.data);
                break;
            }
        }
    }

    async #send<T>(
        request: { type: RequestType; data: unknown },
        transfer?: Transferable[],
    ): Promise<T> {
        await this.#ready;

        const id = String(++nextRequestId);
        const message = { id, ...request };

        this.#worker?.postMessage(message, transfer ? { transfer } : undefined);

        return new Promise<T>((resolve, reject) => {
            this.#promiseResolvers.set(id, {
                resolve: (value) => resolve(value as T),
                reject,
            });
        });
    }
}
