import type { ConnectionController } from "../controller";
import { DispatchedPromise } from "../internal/dispatched-promise";
import type { MlExportOptions, SqlExportOptions } from "../types";
import { Features } from "../utils";

type ExportResult<T, S extends boolean> = S extends true ? ReadableStream<Uint8Array> : T;

/**
 * A configurable `Promise` for export operations.
 */
export class ExportPromise<S extends boolean = false> extends DispatchedPromise<
    ExportResult<string, S>
> {
    #connection: ConnectionController;
    #options: Partial<SqlExportOptions>;
    #stream: boolean;

    constructor(
        connection: ConnectionController,
        options: Partial<SqlExportOptions>,
        stream: boolean,
    ) {
        super();
        this.#connection = connection;
        this.#options = options;
        this.#stream = stream;
    }

    /**
     * Configure the export to return the result as a `ReadableStream`.
     */
    stream(): ExportPromise<true> {
        return new ExportPromise<true>(this.#connection, this.#options, true);
    }

    protected async dispatch(): Promise<ExportResult<string, S>> {
        await this.#connection.ready();

        // Require stream feature
        if (this.#stream) {
            this.#connection.assertFeature(Features.ExportImportStreams);
        }

        const stream = await this.#connection.exportSql(this.#options);

        // Stream was requested, return the stream directly. The feature
        // assertion above ensures that a stream is returned.
        if (this.#stream) {
            return stream as ExportResult<string, S>;
        }

        // Legacy string was returned, return it directly.
        if (typeof stream === "string") {
            return stream as ExportResult<string, S>;
        }

        // Convert stream into string
        return (await stream.text()) as ExportResult<string, S>;
    }
}

/**
 * A configurable `Promise` for model export operations.
 */
export class ExportModelPromise<S extends boolean = false> extends DispatchedPromise<
    ExportResult<Uint8Array, S>
> {
    #connection: ConnectionController;
    #options: MlExportOptions;
    #stream: boolean;

    constructor(connection: ConnectionController, options: MlExportOptions, stream: boolean) {
        super();
        this.#connection = connection;
        this.#options = options;
        this.#stream = stream;
    }

    /**
     * Configure the export to return the result as a `ReadableStream`.
     */
    stream(): ExportModelPromise<true> {
        return new ExportModelPromise<true>(this.#connection, this.#options, true);
    }

    protected async dispatch(): Promise<ExportResult<Uint8Array, S>> {
        await this.#connection.ready();

        // Require SurrealML and stream features
        this.#connection.assertFeature(Features.SurrealML);

        if (this.#stream) {
            this.#connection.assertFeature(Features.ExportImportStreams);
        }

        const stream = await this.#connection.exportMlModel(this.#options);

        // Stream was requested, return the stream directly. The feature
        // assertion above ensures that a stream is returned.
        if (this.#stream) {
            return stream as ExportResult<Uint8Array, S>;
        }

        // Legacy Uint8Array was returned, return it directly.
        if (stream instanceof Uint8Array) {
            return stream as ExportResult<Uint8Array, S>;
        }

        // Convert stream into Uint8Array
        // NOTE - can be replaced by .bytes() once support is widespread
        return new Uint8Array(await stream.arrayBuffer()) as ExportResult<Uint8Array, S>;
    }
}
