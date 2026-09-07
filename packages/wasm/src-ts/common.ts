import init, { type ConnectionOptions, type SurrealWasmEngine } from "@surrealdb/wasm-native";

/**
 * The handle a {@link WebAssemblyEngine} drives the WebAssembly module through.
 *
 * The module can be instantiated in the page or in a Web Worker, and those
 * differ only in how a call reaches it and how notifications come back. Both
 * implementations present this same surface, so the engine itself is unaware of
 * which one it holds.
 */
export interface EngineBroker {
    isConnected: boolean;
    connect(
        url: string,
        options: ConnectionOptions | undefined,
        onNotification: (data: Uint8Array) => void,
    ): Promise<void>;
    execute(payload: Uint8Array): Promise<Uint8Array>;
    /**
     * Run a query, answering with a stream of frames rather than one response.
     *
     * The reader sets the pace: frames are buffered one at a time inside the
     * module, so a reader that stops reading stops the scan, and cancelling the
     * stream is how a consumer walks away from a query it no longer wants.
     */
    queryStream(payload: Uint8Array): Promise<ReadableStream<Uint8Array>>;
    importSql(data: string): Promise<void>;
    exportSql(options: Uint8Array): Promise<string>;
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
): () => Promise<void> {
    let cancelled = false;
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    let resolveExited: (() => void) | undefined;
    const exitedPromise = new Promise<void>((resolve) => {
        resolveExited = resolve;
    });

    const cancel = () => {
        cancelled = true;
        reader?.cancel().catch(() => {});
        return exitedPromise;
    };

    (async () => {
        try {
            reader = engine.notifications().getReader();

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
        } finally {
            resolveExited?.();
        }
    })();

    return cancel;
}

let initPromise: ReturnType<typeof init> | undefined;

/**
 * Initialize the WebAssembly module. Safe to call multiple times; the module
 * is only initialized once and subsequent calls return the same promise.
 *
 * The module is left to resolve itself. `@surrealdb/wasm-native` locates it
 * beside its own loader, which is the one place that knows where it is: a
 * bundler rewrites that reference to the asset it emitted, and a plain
 * `<script type="module">` fetches it from the package.
 */
export async function initializeLibrary(): Promise<void> {
    if (initPromise === undefined) {
        initPromise = init();
    }
    await initPromise;
}
