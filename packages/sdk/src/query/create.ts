import type { DateTime, Duration, Table, Uuid } from "@surrealdb/sqon";
import type { ConnectionController } from "../controller";
import { DispatchedPromise } from "../internal/dispatched-promise";
import { _only, _output, _timeout } from "../internal/internal-expressions";
import type { MaybeJsonify } from "../internal/maybe-jsonify";
import type {
    AnyRecordId,
    Mutation,
    Output,
    Patch,
    RetryOptions,
    RetryValue,
    Session,
    Values,
} from "../types";
import { type BoundQuery, raw, surql } from "../utils";
import type { Frame } from "../utils/frame";
import { Query } from "./query";

interface CreateOptions {
    what: AnyRecordId | Table;
    mutation?: Mutation;
    data?: unknown;
    output?: Output;
    timeout?: Duration;
    version?: DateTime;
    transaction: Uuid | undefined;
    session: Session;
    retry: RetryValue;
    json: boolean;
}

/**
 * A configurable `Promise` for a create query sent to a SurrealDB instance.
 */
export class CreatePromise<T, I, J extends boolean = false> extends DispatchedPromise<
    MaybeJsonify<T, J>
> {
    #connection: ConnectionController;
    #options: CreateOptions;

    constructor(connection: ConnectionController, options: CreateOptions) {
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
    json(): CreatePromise<T, I, true> {
        return new CreatePromise<T, I, true>(this.#connection, {
            ...this.#options,
            json: true,
        });
    }

    /**
     * Configure the query to automatically retry when it fails due to a transaction conflict.
     *
     * Under concurrent load a query may fail because another transaction wrote to the same data.
     * When retry is enabled, the entire query is re-sent with exponential backoff until it
     * succeeds or the configured attempts are exhausted.
     *
     * **NOTE:** Retrying re-sends the full query. Only use this for queries that are safe to replay.
     * Re-sending a non-atomic, multi-statement query may apply some statements more than once.
     *
     * @example
     * ```ts
     * const user = await db.create(new RecordId('users', 'john'))
     *     .content({ name: 'John Doe' })
     *     .retry();
     * ```
     *
     * @param options Retry behavior. Defaults to enabling retry using the connection defaults.
     * @returns A new `CreatePromise` configured to retry on conflict.
     */
    retry(options: boolean | Partial<RetryOptions> = true): CreatePromise<T, I, J> {
        return new CreatePromise<T, I, J>(this.#connection, {
            ...this.#options,
            retry: options,
        });
    }

    /**
     * Configure the query to set the record data
     */
    content(data: Values<I>): CreatePromise<T, I, J> {
        return new CreatePromise<T, I, J>(this.#connection, {
            ...this.#options,
            mutation: "content",
            data,
        });
    }

    /**
     * Configure the query to patch the record data
     */
    patch(data: Patch[]): CreatePromise<T, I, J> {
        return new CreatePromise<T, I, J>(this.#connection, {
            ...this.#options,
            mutation: "patch",
            data,
        });
    }

    /**
     * Configure the output of the query
     */
    output(output: Output): CreatePromise<T, I, J> {
        return new CreatePromise<T, I, J>(this.#connection, {
            ...this.#options,
            output,
        });
    }

    /**
     * Configure the timeout of the query
     */
    timeout(timeout: Duration): CreatePromise<T, I, J> {
        return new CreatePromise<T, I, J>(this.#connection, {
            ...this.#options,
            timeout,
        });
    }

    /**
     * Configure a custom version of the data being created. This is used
     * alongside version enabled storage engines such as SurrealKV.
     */
    version(version: DateTime): CreatePromise<T, I, J> {
        return new CreatePromise<T, I, J>(this.#connection, {
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
            what,
            data,
            transaction,
            session,
            json,
            output,
            timeout,
            version,
            mutation,
            retry,
        } = this.#options;

        const query = surql`CREATE ${_only(what)}`;

        if (mutation && data) {
            query.append(surql` ${raw(mutation.toUpperCase())} ${data}`);
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
            retry,
            query,
            transaction,
            json,
            session,
        });
    }
}
