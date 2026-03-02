import type { ConnectionController } from "../controller";
import { DispatchedPromise } from "../internal/dispatched-promise";
import type { MlExportOptions, SqlExportOptions } from "../types";
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

    constructor(
        connection: ConnectionController,
        options: Partial<SqlExportOptions>,
        raw: boolean,
    ) {
        super();
        this.#connection = connection;
        this.#options = options;
        this.#raw = raw;
    }

    /**
     * Configure the export to return the raw `Response`.
     */
    response(): ExportPromise<true> {
        return new ExportPromise<true>(this.#connection, this.#options, true);
    }

    protected async dispatch(): Promise<ExportResult<string, R>> {
        await this.#connection.ready();

        if (this.#raw) {
            this.#connection.assertFeature(Features.ExportImportRaw);
        }

        const result = await this.#connection.exportSql(this.#options);

        if (this.#raw) {
            return result as ExportResult<string, R>;
        }

        if (typeof result === "string") {
            return result as ExportResult<string, R>;
        }

        return (await result.text()) as ExportResult<string, R>;
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

    constructor(connection: ConnectionController, options: MlExportOptions, raw: boolean) {
        super();
        this.#connection = connection;
        this.#options = options;
        this.#raw = raw;
    }

    /**
     * Configure the export to return the raw `Response`.
     */
    response(): ExportModelPromise<true> {
        return new ExportModelPromise<true>(this.#connection, this.#options, true);
    }

    protected async dispatch(): Promise<ExportResult<Uint8Array, R>> {
        await this.#connection.ready();

        this.#connection.assertFeature(Features.SurrealML);

        if (this.#raw) {
            this.#connection.assertFeature(Features.ExportImportRaw);
        }

        const result = await this.#connection.exportMlModel(this.#options);

        if (this.#raw) {
            return result as ExportResult<Uint8Array, R>;
        }

        if (result instanceof Uint8Array) {
            return result as ExportResult<Uint8Array, R>;
        }

        return new Uint8Array(await result.arrayBuffer()) as ExportResult<Uint8Array, R>;
    }
}
