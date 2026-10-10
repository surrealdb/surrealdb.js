import type { Uuid } from "@surrealdb/sqon";
import type { ConnectionController } from "../controller";
import { ExpressionError } from "../errors";
import { type AbortOptions, addSignal, assertTimeout } from "../internal/abort";
import { assertCredential } from "../internal/auth-provider";
import { DispatchedPromise } from "../internal/dispatched-promise";
import type { MaybeJsonify } from "../internal/maybe-jsonify";
import { validateWith } from "../internal/standard-schema";
import type { AuthOrToken, RetryValue, Session, StandardSchemaV1 } from "../types";
import { BoundQuery, surql } from "../utils";
import type { Frame } from "../utils/frame";
import { Query } from "./query";

const NAME_REGEX = /^[a-zA-Z0-9_:]+$/;
const VERSION_REGEX = /^[0-9.]+$/;

interface RunOptions extends AbortOptions {
    name: string;
    version: string | undefined;
    args: unknown[];
    transaction: Uuid | undefined;
    session: Session;
    retry?: RetryValue;
    credential?: AuthOrToken;
    json: boolean;
    argsSchema?: StandardSchemaV1;
    resultSchema?: StandardSchemaV1;
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
     * Run this call as a different identity than the one of the session, for this call only.
     * The session is neither used nor changed. Supported by engines which present credentials
     * with every request, such as HTTP, and rejected with an `UnsupportedFeatureError` by
     * the others.
     *
     * @see {@link Query.as} for details.
     *
     * @param credential An access token or authentication details to run this call as
     * @returns A new `RunPromise` which runs as the provided identity.
     */
    as(credential: AuthOrToken): RunPromise<T, J> {
        assertCredential(credential);

        return new RunPromise<T, J>(this.#connection, {
            ...this.#options,
            credential,
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
    retry(options: RetryValue = true): RunPromise<T, J> {
        return new RunPromise<T, J>(this.#connection, {
            ...this.#options,
            retry: options,
        });
    }

    /**
     * Configure the query to be abandoned when a signal aborts.
     *
     * If the signal has already aborted, the query is not sent and fails straight away. If it aborts
     * later, the query stops waiting for the server and fails with the `reason` of the signal, as it
     * is: an `AbortError`, or the `TimeoutError` of `AbortSignal.timeout()`. This holds for awaiting
     * the query as well as for `.stream()`, which ends its iteration with the reason.
     *
     * Aborting means "stop waiting", and nothing more. The server may keep executing the query, and
     * **a write which was sent before the signal aborted may or may not have been applied**.
     *
     * Can be called more than once, and in addition to a signal inherited from `withSignal()`: the
     * query is abandoned when any of them aborts. See {@link Query.signal}.
     *
     * @example
     * ```ts
     * const result = await db.run("fn::report").signal(request.signal);
     * ```
     *
     * @param signal The signal which abandons the query. Without one, nothing changes.
     */
    signal(signal: AbortSignal | undefined): RunPromise<T, J> {
        return new RunPromise<T, J>(this.#connection, {
            ...this.#options,
            signals: addSignal(this.#options.signals, signal),
        });
    }

    /**
     * Configure how long to wait for the server to answer the query, in milliseconds, before giving
     * up on it with a `TimeoutError`. Overrides the `requestTimeout` of the connection for this
     * query, so it can also allow a query longer than that default, or `0` to wait without limit.
     *
     * This is a limit on the client, and not the `TIMEOUT` clause which the server enforces and
     * which is set with `.timeout()`. The server is not told the client has given up, so **a write
     * which timed out may or may not have been applied**. See {@link Query.requestTimeout}.
     *
     * @param milliseconds The time to wait for an answer, or `0` for no limit.
     */
    requestTimeout(milliseconds: number): RunPromise<T, J> {
        assertTimeout(milliseconds, "requestTimeout");

        return new RunPromise<T, J>(this.#connection, {
            ...this.#options,
            requestTimeout: milliseconds,
        });
    }

    /**
     * Check the arguments against a [Standard Schema](https://standardschema.dev) (Zod, Valibot,
     * ArkType and others) before the call is sent. The schema validates the array of arguments, so
     * use a tuple schema. When it fails, the call is not sent and rejects with a
     * `SchemaValidationError` listing every issue. What the schema produces is what is sent, so
     * a schema which transforms or coerces changes the arguments.
     *
     * Applies when the promise is awaited, and not to `.compile()` or `.stream()`.
     *
     * @example
     * ```ts
     * const sum = await db.run<number>("fn::add", [1, 2]).args(z.tuple([z.number(), z.number()]));
     * ```
     *
     * @param schema The schema the array of arguments must satisfy.
     */
    args(schema: StandardSchemaV1): RunPromise<T, J> {
        return new RunPromise<T, J>(this.#connection, {
            ...this.#options,
            argsSchema: schema,
        });
    }

    /**
     * Check the result against a [Standard Schema](https://standardschema.dev) and type the
     * promise as what the schema produces. When the result does not match, the promise rejects
     * with a `SchemaValidationError`. With `.json()` the schema sees the JSON-compatible result.
     *
     * @example
     * ```ts
     * const sum = await db.run("fn::add", [1, 2]).returns(z.number()); // number
     * ```
     *
     * @param schema The schema the result must satisfy.
     */
    returns<S extends StandardSchemaV1>(schema: S): RunPromise<StandardSchemaV1.InferOutput<S>, J> {
        return new RunPromise<StandardSchemaV1.InferOutput<S>, J>(this.#connection, {
            ...this.#options,
            resultSchema: schema,
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
        const query = this.#build().stream<T>();

        for await (const frame of query) {
            yield frame;
        }
    }

    protected async dispatch(): Promise<MaybeJsonify<T, J>> {
        const { name, argsSchema, resultSchema } = this.#options;
        let options = this.#options;

        if (argsSchema) {
            const args = await validateWith(argsSchema, options.args, `arguments for ${name}`);
            options = { ...options, args: args as unknown[] };
        }

        const [result] = await this.#build(options).collect();

        return resultSchema
            ? ((await validateWith(resultSchema, result, `result of ${name}`)) as MaybeJsonify<
                  T,
                  J
              >)
            : result;
    }

    #build(options: RunOptions = this.#options): Query<[T], J> {
        const { name, version, args, transaction, session, json, retry } = options;

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
            credential: this.#options.credential,
            retry,
            query,
            transaction,
            json,
            session,
            signals: this.#options.signals,
            requestTimeout: this.#options.requestTimeout,
        });
    }
}
