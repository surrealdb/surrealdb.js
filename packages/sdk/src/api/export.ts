import type { ConnectionController } from "../controller";
import { abortScope, addSignal, assertTimeout, raceAbort, throwIfAborted } from "../internal/abort";
import { assertCredential } from "../internal/auth-provider";
import type { TransferOptions } from "../internal/credentialed";
import { DispatchedPromise } from "../internal/dispatched-promise";
import { readBytes, readText, releaseResponse } from "../internal/http";
import type { AuthOrToken, MlExportOptions, SqlExportOptions } from "../types";
import { Features } from "../utils";

type ExportResult<T, R extends boolean> = R extends true ? Response : T;

/**
 * A configurable `Promise` for export operations.
 */
export class ExportPromise<R extends boolean = false> extends DispatchedPromise<
    ExportResult<string, R>
> {
    #connection: ConnectionController;
    #options: Partial<SqlExportOptions>;
    #raw: boolean;
    #abort: TransferOptions;

    constructor(
        connection: ConnectionController,
        options: Partial<SqlExportOptions>,
        raw: boolean,
        abort: TransferOptions = {},
    ) {
        super();
        this.#connection = connection;
        this.#options = options;
        this.#raw = raw;
        this.#abort = abort;
    }

    /**
     * Configure the export to return the raw `Response` instead of
     * a SurrealQL string. This is useful when you may receive a
     * large amount of data and need to handle the response stream
     * directly.
     *
     * The signal of the export, and its request timeout, keep governing the response after it has
     * been returned: when either fires, reading its body fails with the reason.
     */
    raw(): ExportPromise<true> {
        return new ExportPromise<true>(this.#connection, this.#options, true, this.#abort);
    }

    /**
     * Configure the export to be abandoned when a signal aborts.
     *
     * If the signal has already aborted, nothing is requested. If it aborts later, the export
     * stops and fails with the `reason` of the signal, as it is, and the response stream is
     * cancelled so that nothing keeps downloading. Whether the server stops generating the export
     * is up to the server. Can be called more than once: the export is abandoned when any of the
     * signals aborts. See `Query.signal()`.
     *
     * @param signal The signal which abandons the export. Without one, nothing changes.
     */
    signal(signal: AbortSignal | undefined): ExportPromise<R> {
        return new ExportPromise<R>(this.#connection, this.#options, this.#raw, {
            ...this.#abort,
            signals: addSignal(this.#abort.signals, signal),
        });
    }

    /**
     * Configure how long to allow the whole of the export, including the download, in
     * milliseconds, before giving up on it with a `TimeoutError`.
     *
     * Unlike for queries there is no default from the connection: an export is long running and
     * streamed, so a limit meant for queries would cut it short. Only a limit given here applies.
     * See `Query.requestTimeout()`.
     *
     * @param milliseconds The time to allow, or `0` for no limit.
     */
    requestTimeout(milliseconds: number): ExportPromise<R> {
        assertTimeout(milliseconds, "requestTimeout");

        return new ExportPromise<R>(this.#connection, this.#options, this.#raw, {
            ...this.#abort,
            requestTimeout: milliseconds,
        });
    }

    /**
     * Run this export as a different identity than the one of the connection, for this export
     * only: it is what the server lets that identity export. The connection is neither
     * authenticated, changed, or looked at, and the credential of the connection is not resolved.
     * See `Query.as()`.
     *
     * Pass an access token, or the authentication details accepted by `signin()`, which are
     * exchanged for a token first. Only engines which present credentials with every request
     * support this, which is the HTTP engine: other engines reject the export with an
     * `UnsupportedFeatureError` rather than run it as the connection.
     *
     * @param credential An access token or authentication details to run this export as
     */
    as(credential: AuthOrToken): ExportPromise<R> {
        assertCredential(credential);

        return new ExportPromise<R>(this.#connection, this.#options, this.#raw, {
            ...this.#abort,
            credential,
        });
    }

    protected async dispatch(): Promise<ExportResult<string, R>> {
        const scope = abortScope(this.#abort.signals ?? [], this.#abort.requestTimeout);

        try {
            throwIfAborted(scope.signal);
            await raceAbort(this.#connection.ready(), scope.signal);

            if (this.#raw) {
                this.#connection.assertFeature(Features.ExportImportRaw);
            }

            const { credential } = this.#abort;
            const request = scope.signal && { signal: scope.signal };

            const result = await raceAbort(
                credential === undefined
                    ? this.#connection.exportSql(this.#options, request)
                    : this.#connection.exportSqlAs(this.#options, { ...request, credential }),
                scope.signal,
                (late) => {
                    if (typeof late !== "string") releaseResponse(late);
                },
            );

            if (this.#raw) {
                return result as ExportResult<string, R>;
            }

            if (typeof result === "string") {
                return result as ExportResult<string, R>;
            }

            return (await readText(result, scope.signal)) as ExportResult<string, R>;
        } finally {
            // The response of a raw export is read by the caller, long after this has returned, and
            // is governed by the signal for as long as it is being read
            if (!this.#raw) scope.dispose();
        }
    }
}

/**
 * A configurable `Promise` for model export operations.
 */
export class ExportModelPromise<R extends boolean = false> extends DispatchedPromise<
    ExportResult<Uint8Array, R>
> {
    #connection: ConnectionController;
    #options: MlExportOptions;
    #raw: boolean;
    #abort: TransferOptions;

    constructor(
        connection: ConnectionController,
        options: MlExportOptions,
        raw: boolean,
        abort: TransferOptions = {},
    ) {
        super();
        this.#connection = connection;
        this.#options = options;
        this.#raw = raw;
        this.#abort = abort;
    }

    /**
     * Configure the export to return the raw `Response` instead of
     * a `Uint8Array`. This is useful when you may receive a large
     * amount of data and need to handle the response stream directly.
     *
     * The signal of the export, and its request timeout, keep governing the response after it has
     * been returned: when either fires, reading its body fails with the reason.
     */
    raw(): ExportModelPromise<true> {
        return new ExportModelPromise<true>(this.#connection, this.#options, true, this.#abort);
    }

    /**
     * Configure the export to be abandoned when a signal aborts.
     *
     * If the signal has already aborted, nothing is requested. If it aborts later, the export
     * stops and fails with the `reason` of the signal, as it is, and the response stream is
     * cancelled so that nothing keeps downloading. Can be called more than once: the export is
     * abandoned when any of the signals aborts. See `Query.signal()`.
     *
     * @param signal The signal which abandons the export. Without one, nothing changes.
     */
    signal(signal: AbortSignal | undefined): ExportModelPromise<R> {
        return new ExportModelPromise<R>(this.#connection, this.#options, this.#raw, {
            ...this.#abort,
            signals: addSignal(this.#abort.signals, signal),
        });
    }

    /**
     * Configure how long to allow the whole of the export, including the download, in
     * milliseconds, before giving up on it with a `TimeoutError`.
     *
     * Unlike for queries there is no default from the connection, so only a limit given here
     * applies. See `Query.requestTimeout()`.
     *
     * @param milliseconds The time to allow, or `0` for no limit.
     */
    requestTimeout(milliseconds: number): ExportModelPromise<R> {
        assertTimeout(milliseconds, "requestTimeout");

        return new ExportModelPromise<R>(this.#connection, this.#options, this.#raw, {
            ...this.#abort,
            requestTimeout: milliseconds,
        });
    }

    /**
     * Run this export as a different identity than the one of the connection, for this export
     * only. See `ExportPromise.as()`.
     *
     * @param credential An access token or authentication details to run this export as
     */
    as(credential: AuthOrToken): ExportModelPromise<R> {
        assertCredential(credential);

        return new ExportModelPromise<R>(this.#connection, this.#options, this.#raw, {
            ...this.#abort,
            credential,
        });
    }

    protected async dispatch(): Promise<ExportResult<Uint8Array, R>> {
        const scope = abortScope(this.#abort.signals ?? [], this.#abort.requestTimeout);

        try {
            throwIfAborted(scope.signal);
            await raceAbort(this.#connection.ready(), scope.signal);

            this.#connection.assertFeature(Features.SurrealML);

            if (this.#raw) {
                this.#connection.assertFeature(Features.ExportImportRaw);
            }

            const { credential } = this.#abort;
            const request = scope.signal && { signal: scope.signal };

            const result = await raceAbort(
                credential === undefined
                    ? this.#connection.exportMlModel(this.#options, request)
                    : this.#connection.exportMlModelAs(this.#options, { ...request, credential }),
                scope.signal,
                (late) => {
                    if (!(late instanceof Uint8Array)) releaseResponse(late);
                },
            );

            if (this.#raw) {
                return result as ExportResult<Uint8Array, R>;
            }

            if (result instanceof Uint8Array) {
                return result as ExportResult<Uint8Array, R>;
            }

            return (await readBytes(result, scope.signal)) as ExportResult<Uint8Array, R>;
        } finally {
            // As for `ExportPromise`, a raw response outlives this call
            if (!this.#raw) scope.dispose();
        }
    }
}
