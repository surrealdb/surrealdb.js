import { ConnectionUnavailableError } from "surrealdb";
import { getIncrementalID } from "../../../sdk/src/internal/get-incremental-id";
import type { ConnectionOptions } from "../../wasm/surrealdb";
import type { EngineBroker } from "../common";
import { RequestType, ResponseType, type WorkerMessage } from "./worker-contract";

const WORKER_URL = new URL("./worker-agent.mjs", import.meta.url);

type PromiseResolver<T> = {
    resolve: (value: T) => void;
    reject: (error: Error) => void;
};

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
        options: ConnectionOptions | undefined,
        onNotification: (data: Uint8Array) => void,
    ) {
        this.#handleNotification = onNotification;
        this.#worker = new Worker(WORKER_URL, { type: "module" });
        this.#ready = new Promise<void>((resolve) => {
            this.#markReady = resolve;
        });

        this.#worker.addEventListener("message", (event) => {
            this.#handleMessage(event.data as WorkerMessage);
        });

        await this.#send({
            type: RequestType.CONNECT,
            data: { url, options },
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

        const id = getIncrementalID();
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
