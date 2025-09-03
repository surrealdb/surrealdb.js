import type { ConnectionController } from "../controller";
import { DispatchedPromise } from "../internal/dispatched-promise";
import { _output, _timeout } from "../internal/internal-expressions";
import type { MaybeJsonify } from "../internal/maybe-jsonify";
import type { AnyRecordId, Doc, Output } from "../types";
import { type BoundQuery, surql } from "../utils";
import type { Frame } from "../utils/frame";
import { type DateTime, type Duration, RecordId, type Table, type Uuid } from "../value";
import { Query } from "./query";

interface RelateOptions {
    from: AnyRecordId | AnyRecordId[];
    what: Table | RecordId;
    to: AnyRecordId | AnyRecordId[];
    unique?: boolean;
    output?: Output;
    timeout?: Duration;
    version?: DateTime;
    data?: Doc;
    transaction: Uuid | undefined;
    json: boolean;
}

/**
 * A configurable `Promise` for a relate query sent to a SurrealDB instance.
 */
export class RelatePromise<T, J extends boolean = false> extends DispatchedPromise<
    MaybeJsonify<T, J>
> {
    #connection: ConnectionController;
    #options: RelateOptions;

    constructor(connection: ConnectionController, options: RelateOptions) {
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
    json(): RelatePromise<T, true> {
        return new RelatePromise<T, true>(this.#connection, {
            ...this.#options,
            json: true,
        });
    }

    /**
     * Configure the query to enforce a unique relationship
     */
    unique(): RelatePromise<T, J> {
        return new RelatePromise<T, J>(this.#connection, {
            ...this.#options,
            unique: true,
        });
    }

    /**
     * Configure the output of the query
     */
    output(output: Output): RelatePromise<T, J> {
        return new RelatePromise<T, J>(this.#connection, {
            ...this.#options,
            output,
        });
    }

    /**
     * Configure the timeout of the query
     */
    timeout(timeout: Duration): RelatePromise<T, J> {
        return new RelatePromise<T, J>(this.#connection, {
            ...this.#options,
            timeout,
        });
    }

    /**
     * Configure a custom version of the data being created. This is used
     * alongside version enabled storage engines such as SurrealKV.
     */
    version(version: DateTime): RelatePromise<T, J> {
        return new RelatePromise<T, J>(this.#connection, {
            ...this.#options,
            version,
        });
    }

    /**
     * Compile this qurery into a BoundQuery
     */
    compile(): BoundQuery {
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
        return result as MaybeJsonify<T, J>;
    }

    #build(): Query<J> {
        const { from, what, to, data, transaction, json, output, timeout, version } = this.#options;

        const isMultiple = Array.isArray(from) || Array.isArray(to);

        if (isMultiple && what instanceof RecordId) {
            throw new Error("Edge must be a table when creating multiple edges");
        }

        const query = surql`RELATE `;

        if (!isMultiple) {
            query.append(surql` ONLY`);
        }

        query.append(surql` ${from}->${what}->${to}`);

        if (data) {
            query.append(surql` CONTENT ${data}`);
        }

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
        });
    }
}
