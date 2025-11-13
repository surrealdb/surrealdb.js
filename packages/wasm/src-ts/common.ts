import init, { type ConnectionOptions, type SurrealWasmEngine } from "../wasm/surrealdb";

export interface EngineBroker {
    isConnected: boolean;
    connect(
        url: string,
        options: ConnectionOptions | undefined,
        onNotification: (data: Uint8Array) => void,
    ): Promise<void>;
    execute(payload: Uint8Array): Promise<Uint8Array>;
    close(): Promise<void>;
}

export interface Message<T> {
    method: T;
    data: unknown;
}

export function readNotifications(
    engine: SurrealWasmEngine,
    handle: (data: Uint8Array) => void,
    signal?: AbortSignal,
): () => void {
    let cancelled = false;
    const cancel = () => {
        cancelled = true;
    };

    (async () => {
        try {
            const reader = engine.notifications().getReader();

            while (!cancelled && !signal?.aborted) {
                const { done, value } = await reader.read();

                if (done || cancelled || signal?.aborted) {
                    break;
                }

                handle(value);
            }

            if (!cancelled && !signal?.aborted) {
                await reader.cancel();
            }
        } catch {
            // There is no way to handle errors here, so we just ignore them
        }
    })();

    return cancel;
}

export async function initializeLibrary() {
    const wasmUrl = new URL("../wasm/surrealdb_bg.wasm", import.meta.url);
    const wasmCode = await (await fetch(wasmUrl)).arrayBuffer();

    await init(wasmCode);
}
