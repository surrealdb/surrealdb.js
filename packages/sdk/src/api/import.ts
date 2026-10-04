import type { ConnectionController } from "../controller";
import {
    type AbortOptions,
    abortScope,
    addSignal,
    assertTimeout,
    raceAbort,
    throwIfAborted,
} from "../internal/abort";
import { DispatchedPromise } from "../internal/dispatched-promise";

/**
 * A configurable `Promise` for import operations.
 *
 * Like every other query, it does nothing until it is awaited, or has `.then()` called on it.
 */
export class ImportPromise extends DispatchedPromise<void> {
    #connection: ConnectionController;
    #input: string | Blob | ReadableStream;
    #abort: AbortOptions;

    constructor(
        connection: ConnectionController,
        input: string | Blob | ReadableStream,
        abort: AbortOptions = {},
    ) {
        super();
        this.#connection = connection;
        this.#input = input;
        this.#abort = abort;
    }

    /**
     * Configure the import to be abandoned when a signal aborts.
     *
     * If the signal has already aborted, nothing is sent. If it aborts later, the import stops
     * waiting and fails with the `reason` of the signal, as it is. A stream being uploaded is
     * cancelled with the same reason, so that nothing keeps reading from it.
     *
     * Aborting stops the upload and the waiting, and nothing more: if the server had received the
     * whole import and begun executing it, it may carry on, and **the import may or may not have been
     * applied**. Can be called more than once: the import is abandoned when any of the signals
     * aborts. See `Query.signal()`.
     *
     * @param signal The signal which abandons the import. Without one, nothing changes.
     */
    signal(signal: AbortSignal | undefined): ImportPromise {
        return new ImportPromise(this.#connection, this.#input, {
            ...this.#abort,
            signals: addSignal(this.#abort.signals, signal),
        });
    }

    /**
     * Configure how long to allow the whole of the import, including the upload, in
     * milliseconds, before giving up on it with a `TimeoutError`.
     *
     * Unlike for queries there is no default from the connection: an import is long running and
     * may be streamed, so a limit meant for queries would cut it short. Only a limit given here
     * applies. As for a signal, the import may or may not have been applied when it expires. See
     * `Query.requestTimeout()`.
     *
     * @param milliseconds The time to allow, or `0` for no limit.
     */
    requestTimeout(milliseconds: number): ImportPromise {
        assertTimeout(milliseconds, "requestTimeout");

        return new ImportPromise(this.#connection, this.#input, {
            ...this.#abort,
            requestTimeout: milliseconds,
        });
    }

    protected async dispatch(): Promise<void> {
        const scope = abortScope(this.#abort.signals ?? [], this.#abort.requestTimeout);

        try {
            throwIfAborted(scope.signal);
            await raceAbort(this.#connection.ready(), scope.signal);
            await raceAbort(
                this.#connection.importSql(this.#input, scope.signal && { signal: scope.signal }),
                scope.signal,
            );
        } finally {
            scope.dispose();
        }
    }
}
