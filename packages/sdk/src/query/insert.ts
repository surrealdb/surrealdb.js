import type { ConnectionController } from "../controller";
import { DispatchedPromise } from "../internal/dispatched-promise";
import { _output, _timeout } from "../internal/internal-expressions";
import type { MaybeJsonify } from "../internal/maybe-jsonify";
import type { Output, Session } from "../types";
import { type BoundQuery, surql } from "../utils";
import type { Frame } from "../utils/frame";
import type { DateTime, Duration, Table, Uuid } from "../value";
import { Query } from "./query";

interface InsertOptions {
    table: Table | undefined;
    what: unknown | unknown[];
    relation?: boolean;
    ignore?: boolean;
    output?: Output;
    timeout?: Duration;
    version?: DateTime;
    transaction: Uuid | undefined;
    session: Session;
    json: boolean;
}

/**
 * A configurable `Promise` for an insert query sent to a SurrealDB instance.
 */
export class InsertPromise<T, J extends boolean = false> extends DispatchedPromise<
    MaybeJsonify<T, J>
> {
    #connection: ConnectionController;
    #options: InsertOptions;

    constructor(connection: ConnectionController, options: InsertOptions) {
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
    json(): InsertPromise<T, true> {
        return new InsertPromise<T, true>(this.#connection, {
            ...this.#options,
            json: true,
        });
    }

    /**
     * Configure the query to insert a relation instead of a regular record
     */
    relation(): InsertPromise<T, J> {
        return new InsertPromise<T, J>(this.#connection, {
            ...this.#options,
            relation: true,
        });
    }

    /**
     * Configure the query to ignore records if they already exist
     */
    ignore(): InsertPromise<T, J> {
        return new InsertPromise<T, J>(this.#connection, {
            ...this.#options,
            ignore: true,
        });
    }

    /**
     * Configure the output of the query
     */
    output(output: Output): InsertPromise<T, J> {
        return new InsertPromise<T, J>(this.#connection, {
            ...this.#options,
            output,
        });
    }

    /**
     * Configure the timeout of the query
     */
    timeout(timeout: Duration): InsertPromise<T, J> {
        return new InsertPromise<T, J>(this.#connection, {
            ...this.#options,
            timeout,
        });
    }

    /**
     * Configure a custom version of the data being created. This is used
     * alongside version enabled storage engines such as SurrealKV.
     */
    version(version: DateTime): InsertPromise<T, J> {
        return new InsertPromise<T, J>(this.#connection, {
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
        const {
            table,
            what,
            transaction,
            session,
            json,
            output,
            timeout,
            version,
            relation,
            ignore,
        } = this.#options;

        const query = surql`INSERT`;

        if (relation) {
            query.append(surql` RELATION`);
        }

        if (ignore) {
            query.append(surql` IGNORE`);
        }

        if (table) {
            query.append(surql` INTO ${table}`);
        }

        query.append(surql` ${what}`);

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
