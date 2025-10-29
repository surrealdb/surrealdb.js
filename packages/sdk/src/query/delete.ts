import type { ConnectionController } from "../controller";
import { DispatchedPromise } from "../internal/dispatched-promise";
import { _only, _output, _timeout } from "../internal/internal-expressions";
import type { MaybeJsonify } from "../internal/maybe-jsonify";
import type { Output, Session } from "../types";
import { type BoundQuery, surql } from "../utils";
import type { Frame } from "../utils/frame";
import type { DateTime, Duration, RecordId, RecordIdRange, Table, Uuid } from "../value";
import { Query } from "./query";

interface DeleteOptions {
    what: RecordId | RecordIdRange | Table;
    output?: Output;
    timeout?: Duration;
    version?: DateTime;
    transaction: Uuid | undefined;
    session: Session;
    json: boolean;
}

/**
 * A configurable `Promise` for a delete query sent to a SurrealDB instance.
 */
export class DeletePromise<T, J extends boolean = false> extends DispatchedPromise<
    MaybeJsonify<T, J>
> {
    #connection: ConnectionController;
    #options: DeleteOptions;

    constructor(connection: ConnectionController, options: DeleteOptions) {
        super();
        this.#connection = connection;
        this.#options = options;
    }

    /**
     * Configure the query to return the result as a
     * JSON-compatible structure.
     *
     * This is useful when query results need to be serialized. Keep in mind
     * that your responses will lose SurrealDB type information.
     */
    json(): DeletePromise<T, true> {
        return new DeletePromise<T, true>(this.#connection, {
            ...this.#options,
            json: true,
        });
    }

    /**
     * Configure the output of the query
     */
    output(output: Output): DeletePromise<T, J> {
        return new DeletePromise<T, J>(this.#connection, {
            ...this.#options,
            output,
        });
    }

    /**
     * Configure the timeout of the query
     */
    timeout(timeout: Duration): DeletePromise<T, J> {
        return new DeletePromise<T, J>(this.#connection, {
            ...this.#options,
            timeout,
        });
    }

    /**
     * Configure a custom version of the data being created. This is used
     * alongside version enabled storage engines such as SurrealKV.
     */
    version(version: DateTime): DeletePromise<T, J> {
        return new DeletePromise<T, J>(this.#connection, {
            ...this.#options,
            version,
        });
    }

    /**
     * Compile this qurery into a BoundQuery
     */
    compile(): BoundQuery<[T]> {
        return this.#build().inner;
    }

    /**
     * Stream the results of the query as they are received.
     *
     * @returns An async iterable of query frames.
     */
    async *stream(): AsyncIterable<Frame<T, J>> {
        await this.#connection.ready();
        const query = this.#build().stream<T>();

        for await (const frame of query) {
            yield frame;
        }
    }

    protected async dispatch(): Promise<MaybeJsonify<T, J>> {
        await this.#connection.ready();
        const [result] = await this.#build().collect();
        return result;
    }

    #build(): Query<[T], J> {
        const { what, transaction, session, json, output, timeout, version } = this.#options;

        const query = surql`DELETE ${_only(what)}`;

        if (output) {
            query.append(surql` RETURN ${_output(output)}`);
        }

        if (timeout) {
            query.append(surql` TIMEOUT ${_timeout(timeout)}`);
        }

        if (version) {
            query.append(surql` VERSION ${version}`);
        }

        return new Query(this.#connection, {
            query,
            transaction,
            json,
            session,
        });
    }
}
