import { ConnectionUnavailableError } from "surrealdb";
import { type ConnectionOptions, SurrealWasmEngine } from "../wasm/surrealdb";
import { type Broker, close, readNotifications } from "./engine-common";

export class WebAssemblyEngineBroker implements Broker {
    #engine: SurrealWasmEngine | undefined;
    #active = false;

    get isConnected() {
        return this.#active && !!this.#engine;
    }

    async connect(url: string, options: ConnectionOptions | undefined) {
        this.#active = true;
        this.#engine = await SurrealWasmEngine.connect(url.toString(), options);
    }

    readNotifications(onNotification: (data: Uint8Array<ArrayBufferLike>) => void) {
        void readNotifications({
            shouldKeepWorking: () => this.#active,
            notify: onNotification,
        })(null, this.#engine);
        return Promise.resolve();
    }

    execute(payload: Uint8Array<ArrayBufferLike>) {
        if (!this.#active || !this.#engine) {
            throw new ConnectionUnavailableError();
        }
        return this.#engine.execute(payload);
    }

    close() {
        this.#active = false;
        close(null, this.#engine);
        this.#engine = undefined;
        return Promise.resolve();
    }
}
