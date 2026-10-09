import type { ConnectionController } from "../controller";
import { abortScope, addSignal, assertTimeout, raceAbort, throwIfAborted } from "../internal/abort";
import { assertCredential } from "../internal/auth-provider";
import type { TransferOptions } from "../internal/credentialed";
import { DispatchedPromise } from "../internal/dispatched-promise";
import { reportProgress } from "../internal/progress";
import type { AuthOrToken, ProgressCallback } from "../types";

/**
 * A configurable `Promise` for import operations.
 *
 * Like every other query, it does nothing until it is awaited, or has `.then()` called on it.
 */
export class ImportPromise extends DispatchedPromise<void> {
    #connection: ConnectionController;
    #input: string | Blob | ReadableStream;
    #abort: TransferOptions;

    constructor(
        connection: ConnectionController,
        input: string | Blob | ReadableStream,
        abort: TransferOptions = {},
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

    /**
     * Run this import as a different identity than the one of the connection, for this import
     * only. The connection is neither authenticated, changed, or looked at, and the credential
     * of the connection is not resolved. See `Query.as()`.
     *
     * Pass an access token, or the authentication details accepted by `signin()`, which are
     * exchanged for a token first. Only engines which present credentials with every request
     * support this, which is the HTTP engine: other engines reject the import with an
     * `UnsupportedFeatureError` rather than run it as the connection. A stream is uploaded once
     * and never sent again, so a token which the server refuses fails the import.
     *
     * @param credential An access token or authentication details to run this import as
     */
    as(credential: AuthOrToken): ImportPromise {
        assertCredential(credential);

        return new ImportPromise(this.#connection, this.#input, {
            ...this.#abort,
            credential,
        });
    }

    /**
     * Configure a callback to be told how much of the import has been uploaded, each time more of
     * it has been.
     *
     * The server executes an import as it reads it, so what has been uploaded is close behind what
     * has been applied. Once all of it has been, the import waits for the server to finish the last
     * of it. The total is known for a string or a `Blob`, and not for a stream.
     *
     * Progress is reported by the HTTP and WebSocket engines, which upload an import. In a browser,
     * which cannot follow the upload of a string or a `Blob` with `fetch`, it is followed with
     * `XMLHttpRequest`, except on a connection given a `fetchImpl` or one which resolves a
     * credential for each request, which report nothing for them. Embedded engines apply an import
     * in one call and report nothing. Replaces a callback configured before.
     *
     * @param callback Called with the bytes uploaded so far, and the total when it is known
     */
    progress(callback: ProgressCallback): ImportPromise {
        return new ImportPromise(this.#connection, this.#input, {
            ...this.#abort,
            progress: callback,
        });
    }

    protected async dispatch(): Promise<void> {
        const scope = abortScope(this.#abort.signals ?? [], this.#abort.requestTimeout);

        try {
            throwIfAborted(scope.signal);
            await raceAbort(this.#connection.ready(), scope.signal);
            const { credential, progress } = this.#abort;
            const request = {
                signal: scope.signal,
                uploadProgress: progress && reportProgress(progress),
            };

            await raceAbort(
                credential === undefined
                    ? this.#connection.importSql(this.#input, request)
                    : this.#connection.importSqlAs(this.#input, { ...request, credential }),
                scope.signal,
            );
        } finally {
            scope.dispose();
        }
    }
}
