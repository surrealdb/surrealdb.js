import { ConnectionUnavailableError } from "surrealdb";
import { type ConnectionOptions, SurrealWasmEngine } from "../wasm/surrealdb";

export interface Broker {
    isConnected: boolean;
    connect(url: string, options: ConnectionOptions | undefined): Promise<void>;
    readNotifications(onNotification: (data: Uint8Array<ArrayBufferLike>) => void): Promise<void>;
    execute(payload: Uint8Array<ArrayBufferLike>): Promise<Uint8Array<ArrayBufferLike>>;
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
    notify: (value: Uint8Array<ArrayBufferLike>) => void;
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
        payload: Uint8Array<ArrayBufferLike>;
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
