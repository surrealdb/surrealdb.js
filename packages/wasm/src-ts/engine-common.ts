import { ConnectionUnavailableError } from "surrealdb";
import { type ConnectionOptions, SurrealWasmEngine } from "../wasm/surrealdb";

export interface Broker {
    isConnected: boolean;
    connect(url: string, options: ConnectionOptions | undefined): Promise<void>;
    readNotifications(onNotification: (data: Uint8Array) => void): Promise<void>;
    execute(payload: Uint8Array): Promise<Uint8Array>;
    close(): Promise<void>;
}

export async function connect({
    url,
    options,
}: {
    url: string;
    options: ConnectionOptions | undefined;
}) {
    return SurrealWasmEngine.connect(url, options);
}

export function readNotifications<Context>({
    shouldKeepWorking,
    notify,
}: {
    shouldKeepWorking: (context: Context) => boolean;
    notify: (value: Uint8Array) => void;
}) {
    return async (context: Context, engine: SurrealWasmEngine | undefined) => {
        if (engine === undefined) {
            return;
        }

        const reader = engine.notifications().getReader();
        while (shouldKeepWorking(context)) {
            const { done, value } = await reader.read();

            if (done) {
                break;
            }

            notify(value);
        }
    };
}

export async function execute<
    Context extends {
        payload: Uint8Array;
    },
>(context: Context, engine: SurrealWasmEngine | undefined) {
    if (engine === undefined) {
        throw new ConnectionUnavailableError();
    }

    return engine.execute(context.payload);
}

export function close<Context>(_context: Context, engine: SurrealWasmEngine | undefined) {
    engine?.free();
}
