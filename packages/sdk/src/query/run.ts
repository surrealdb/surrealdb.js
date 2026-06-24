import type { Uuid } from "@surrealdb/sqon";
import type { ConnectionController } from "../controller";
import { ExpressionError } from "../errors";
import { DispatchedPromise } from "../internal/dispatched-promise";
import type { MaybeJsonify } from "../internal/maybe-jsonify";
import type { RetryContext } from "../internal/retry";
import type { RetryOptions, Session } from "../types";
import { BoundQuery, surql } from "../utils";
import type { Frame } from "../utils/frame";
import { Query } from "./query";

const NAME_REGEX = /^[a-zA-Z0-9_:]+$/;
const VERSION_REGEX = /^[0-9.]+$/;

interface RunOptions {
    name: string;
    version: string | undefined;
    args: unknown[];
    transaction: Uuid | undefined;
    session: Session;
    retry: RetryContext;
    json: boolean;
}

/**
 * A configurable `Promise` for a run query sent to a SurrealDB instance.
 */
export class RunPromise<T, J extends boolean = false> extends DispatchedPromise<
    MaybeJsonify<T, J>
> {
    #connection: ConnectionController;
    #options: RunOptions;

    constructor(connection: ConnectionController, options: RunOptions) {
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
    json(): RunPromise<T, true> {
        return new RunPromise<T, true>(this.#connection, {
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
     * const result = await db.run('my::function', [arg]).retry();
     * ```
     *
     * @param options Retry behavior. Defaults to enabling retry using the connection defaults.
     * @returns A new `RunPromise` configured to retry on conflict.
     */
    retry(options: boolean | Partial<RetryOptions> = true): RunPromise<T, J> {
        return new RunPromise<T, J>(this.#connection, {
            ...this.#options,
            retry: this.#options.retry.extend(options),
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
        const { name, version, args, transaction, session, json, retry } = this.#options;

        if (!NAME_REGEX.test(name)) {
            throw new ExpressionError("Invalid function name");
        }

        const query = new BoundQuery(name);

        if (version) {
            if (!VERSION_REGEX.test(version)) {
                throw new ExpressionError("Invalid function version");
            }

            query.append(`<${version}>`);
        }

        query.append("(");

        for (const arg of args) {
            query.append(surql`${arg}, `);
        }

        query.append(")");

        return new Query(this.#connection, {
            retry,
            query,
            transaction,
            json,
            session,
        });
    }
}
