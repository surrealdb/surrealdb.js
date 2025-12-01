import { ConnectionUnavailableError } from "surrealdb";
import { type ConnectionOptions, SurrealWasmEngine } from "../../wasm/surrealdb";
import { type EngineBroker, initializeLibrary, readNotifications } from "../common";

export class LocalEngineBroker implements EngineBroker {
    #engine: SurrealWasmEngine | undefined;
    #active = false;
    #cancelNotifications: (() => void) | undefined;
    #abortController: AbortController | undefined;

    get isConnected() {
        return this.#active && !!this.#engine;
    }

    async connect(
        url: string,
        options: ConnectionOptions | undefined,
        onNotification: (data: Uint8Array) => void,
    ) {
        this.#cancelNotifications?.();
        this.#abortController?.abort();
        this.#engine?.free();

        await initializeLibrary();

        this.#engine = await SurrealWasmEngine.connect(url.toString(), options);
        this.#active = true;

        this.#abortController = new AbortController();
        this.#cancelNotifications = readNotifications(
            this.#engine,
            onNotification,
            this.#abortController.signal,
        );
    }

    execute(payload: Uint8Array) {
        if (!this.#active || !this.#engine) {
            throw new ConnectionUnavailableError();
        }

        return this.#engine.execute(payload);
    }

    async importSql(data: string): Promise<void> {
        if (!this.#active || !this.#engine) {
            throw new ConnectionUnavailableError();
        }

        return this.#engine.import(data);
    }

    async exportSql(options: Uint8Array): Promise<string> {
        if (!this.#active || !this.#engine) {
            throw new ConnectionUnavailableError();
        }

        return this.#engine.export(options);
    }

    async close() {
        this.#active = false;
        this.#cancelNotifications?.();
        this.#cancelNotifications = undefined;
        this.#abortController?.abort();
        this.#abortController = undefined;
        this.#engine?.free();
        this.#engine = undefined;
    }
}
