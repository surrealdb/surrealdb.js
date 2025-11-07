import { ConnectionUnavailableError } from "surrealdb";
import type { ConnectionOptions } from "../wasm/surrealdb";
import type { Broker } from "./engine-common";
import { Request, type Requests, Response, type ResponseHandlers } from "./engine-web-worker";

export class WebAssemblyEngineWebWorkerBroker implements Broker {
    #worker: Worker | undefined;
    #onWorkerReady!: (worker: Worker) => void;
    #workerReady = new Promise<Worker>((resolve) => {
        this.#onWorkerReady = resolve;
    });
    #instanceId: number | undefined;
    #lastPromiseId = 0;
    #promiseResolvers = new Map<number, (value: unknown, isError: boolean) => void>();
    #handlers = [] as unknown as ResponseHandlers;

    get isConnected() {
        return this.#instanceId !== undefined && !!this.#worker;
    }

    async #post<R extends keyof Requests>(
        request: R,
        data: Parameters<Requests[R]>[0],
        transfer?: Transferable[],
    ): Promise<ReturnType<Requests[R]>> {
        const worker = await this.#workerReady;
        ++this.#lastPromiseId;
        const promiseId = this.#lastPromiseId;
        worker.postMessage({ request, promiseId, data }, transfer ? { transfer } : undefined);
        return new Promise<ReturnType<Requests[R]>>((resolve, reject) => {
            this.#promiseResolvers.set(promiseId, (res, err) => {
                err ? reject(res) : resolve(res as never);
            });
        });
    }

    async connect(url: string, options: ConnectionOptions | undefined) {
        const worker = new Worker("./worker.ts");
        this.#worker = worker;
        this.#handlers[Response.READY] = () => this.#onWorkerReady(worker);
        this.#handlers[Response.ERROR] = (promiseId, data) => {
            const resolve = this.#promiseResolvers.get(promiseId);
            if (resolve === undefined) return;
            this.#promiseResolvers.delete(promiseId);
            resolve(data, true);
        };
        this.#handlers[Response.RESPONSE] = (promiseId, data) => {
            const resolve = this.#promiseResolvers.get(promiseId);
            if (resolve === undefined) return;
            this.#promiseResolvers.delete(promiseId);
            resolve(data, false);
        };
        this.#worker.addEventListener("message", (event) => {
            const data = event.data as {
                response: Response;
                promiseId: number;
                data: never;
            };
            this.#handlers[data.response](data.promiseId, data.data);
        });
        this.#instanceId = await this.#post(Request.CONNECT, {
            url,
            options,
        });
    }

    async readNotifications(onNotification: (data: Uint8Array<ArrayBufferLike>) => void) {
        if (this.#instanceId === undefined) {
            throw new ConnectionUnavailableError();
        }

        this.#handlers[Response.NOTIFICATION] = (_, data) => onNotification(data);
        await this.#post(Request.READ_NOTIFICATIONS, {
            instanceId: this.#instanceId,
        });
    }

    execute(payload: Uint8Array<ArrayBufferLike>) {
        if (this.#instanceId === undefined) {
            throw new ConnectionUnavailableError();
        }

        return this.#post(Request.EXECUTE, { instanceId: this.#instanceId, payload }, [
            payload.buffer,
        ]);
    }

    async close() {
        if (this.#instanceId !== undefined) {
            await this.#post(Request.CLOSE, { instanceId: this.#instanceId });
            this.#worker = undefined;
            this.#instanceId = undefined;
            this.#workerReady = new Promise<Worker>((resolve) => {
                this.#onWorkerReady = resolve;
            });
        }
    }
}
