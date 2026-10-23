import type { Uuid } from "@surrealdb/sqon";
import type { ConnectionController } from "../controller";
import { SurrealError, UnsuccessfulApiError } from "../errors";
import {
    type AbortOptions,
    abortScope,
    addSignal,
    assertTimeout,
    raceAbort,
    throwIfAborted,
} from "../internal/abort";
import { assertCredential } from "../internal/auth-provider";
import { DispatchedPromise } from "../internal/dispatched-promise";
import { type MaybeJsonify, maybeJsonify } from "../internal/maybe-jsonify";
import { validateWith } from "../internal/standard-schema";
import type { AuthOrToken, Session, StandardSchemaV1 } from "../types";
import { type BoundQuery, surql } from "../utils";
import type { Frame } from "../utils/frame";
import { Query } from "./query";

/**
 * The response information for an api request.
 */
export interface ApiResponse<T> {
    body?: T;
    headers?: Record<string, string>;
    status?: number;
}

type Result<Res, V extends boolean> = V extends true ? Res : ApiResponse<Res>;
type Collect<Res, V extends boolean, J extends boolean> = MaybeJsonify<Result<Res, V>, J>;

interface ApiOptions<Req> extends AbortOptions {
    path: string;
    body?: Req;
    method: string;
    headers: Record<string, string>;
    query: Record<string, string>;
    transaction: Uuid | undefined;
    session: Session;
    value: boolean;
    credential?: AuthOrToken;
    json: boolean;
    requestSchema?: StandardSchemaV1;
    responseSchema?: StandardSchemaV1;
}

/**
 * A configurable `Promise` for an api request sent to a SurrealDB instance.
 */
export class ApiPromise<
    Req,
    Res,
    V extends boolean = false,
    J extends boolean = false,
> extends DispatchedPromise<Collect<Res, V, J>> {
    #connection: ConnectionController;
    #options: ApiOptions<Req>;

    constructor(connection: ConnectionController, options: ApiOptions<Req>) {
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
    json(): ApiPromise<Req, Res, V, true> {
        return new ApiPromise<Req, Res, V, true>(this.#connection, {
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
     * @returns A new `ApiPromise` which runs as the provided identity.
     */
    as(credential: AuthOrToken): ApiPromise<Req, Res, V, J> {
        assertCredential(credential);

        return new ApiPromise<Req, Res, V, J>(this.#connection, {
            ...this.#options,
            credential,
        });
    }

    /**
     * Append a header to the api request.
     *
     * @param name The name of the header to append.
     * @param value The value of the header to append.
     */
    header(name: string, value: string): ApiPromise<Req, Res, V, J> {
        return new ApiPromise<Req, Res, V, J>(this.#connection, {
            ...this.#options,
            headers: { ...this.#options.headers, [name]: value },
        });
    }

    /**
     * Append a query parameter to the api request.
     *
     * @param name The name of the query parameter to append.
     * @param value The value of the query parameter to append.
     * @returns A new ApiPromise instance.
     */
    query(name: string, value: string): ApiPromise<Req, Res, V, J> {
        return new ApiPromise<Req, Res, V, J>(this.#connection, {
            ...this.#options,
            query: { ...this.#options.query, [name]: value },
        });
    }

    /**
     * Configure the query to return the response body value
     * as the result. If the response status is not 200, the promise will reject.
     */
    value(): ApiPromise<Req, Res, true, J> {
        return new ApiPromise<Req, Res, true, J>(this.#connection, {
            ...this.#options,
            value: true,
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
     * const result = await db.api().get("/report").signal(request.signal);
     * ```
     *
     * @param signal The signal which abandons the query. Without one, nothing changes.
     */
    signal(signal: AbortSignal | undefined): ApiPromise<Req, Res, V, J> {
        return new ApiPromise<Req, Res, V, J>(this.#connection, {
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
    requestTimeout(milliseconds: number): ApiPromise<Req, Res, V, J> {
        assertTimeout(milliseconds, "requestTimeout");

        return new ApiPromise<Req, Res, V, J>(this.#connection, {
            ...this.#options,
            requestTimeout: milliseconds,
        });
    }

    /**
     * Check the request body against a [Standard Schema](https://standardschema.dev) (Zod,
     * Valibot, ArkType and others) before the request is sent. When it fails, the request is not
     * sent and the promise rejects with a `SchemaValidationError` listing every issue. What the
     * schema produces is what is sent, so a schema which transforms or coerces changes the body.
     *
     * Applies when the promise is awaited, and not to `.compile()` or `.stream()`.
     *
     * @example
     * ```ts
     * await db.api().post("/users", body).request(z.object({ name: z.string() }));
     * ```
     *
     * @param schema The schema the request body must satisfy.
     */
    request(schema: StandardSchemaV1): ApiPromise<Req, Res, V, J> {
        return new ApiPromise<Req, Res, V, J>(this.#connection, {
            ...this.#options,
            requestSchema: schema,
        });
    }

    /**
     * Check the response body against a [Standard Schema](https://standardschema.dev) and type the
     * promise as what the schema produces. Only the body of a successful response (status 200 to
     * 299) is checked, because an error response carries a different body. When the body does not
     * match, the promise rejects with a `SchemaValidationError`.
     *
     * @example
     * ```ts
     * const users = await db.api().get("/users").response(z.array(User)).value();
     * ```
     *
     * @param schema The schema the response body must satisfy.
     */
    response<S extends StandardSchemaV1>(
        schema: S,
    ): ApiPromise<Req, StandardSchemaV1.InferOutput<S>, V, J> {
        return new ApiPromise<Req, StandardSchemaV1.InferOutput<S>, V, J>(this.#connection, {
            ...this.#options,
            responseSchema: schema,
        });
    }

    /**
     * Compile an explicit `api::invoke` SQL query. Executing this compiled query requires
     * query access, including on remote connections whose API calls normally use HTTP.
     */
    compile(): BoundQuery<[ApiResponse<Res>]> {
        return this.#build().inner;
    }

    /**
     * Stream the results of the query as they are received.
     *
     * @returns An async iterable of query frames.
     */
    async *stream(): AsyncIterable<Frame<ApiResponse<Res>, J>> {
        const query = this.#build().stream<ApiResponse<Res>>();

        for await (const frame of query) {
            yield frame;
        }
    }

    protected async dispatch(): Promise<Collect<Res, V, J>> {
        const { path, method, requestSchema, responseSchema } = this.#options;
        const label = `${method.toUpperCase()} ${path}`;
        let options = this.#options;

        if (requestSchema) {
            const body = await validateWith(
                requestSchema,
                options.body,
                `request body for ${label}`,
            );
            options = { ...options, body: body as Req };
        }

        const result = maybeJsonify(await this.#invoke(options), options.json);

        if (!("body" in result) || typeof result.status !== "number") {
            throw new SurrealError("Body or status was missing from the API response");
        }

        if (responseSchema && isSuccessful(result.status)) {
            result.body = (await validateWith(
                responseSchema,
                result.body,
                `response body of ${label}`,
            )) as typeof result.body;
        }

        if (this.#options.value) {
            if ("status" in result && !isSuccessful(result.status)) {
                throw new UnsuccessfulApiError(this.#options.path, this.#options.method, result);
            }

            return result.body as Collect<Res, V, J>;
        }

        return result as Collect<Res, V, J>;
    }

    async #invoke(options: ApiOptions<Req>): Promise<ApiResponse<Res>> {
        const { path, transaction, session, credential } = options;
        const scope = abortScope(options.signals ?? []);
        try {
            throwIfAborted(scope.signal);
            await raceAbort(this.#connection.ready(), scope.signal);
            const request = abortScope(
                scope.signal ? [scope.signal] : [],
                options.requestTimeout ?? this.#connection.requestTimeout,
            );
            try {
                throwIfAborted(request.signal);
                const { signal } = request;
                return await raceAbort(
                    credential === undefined
                        ? this.#connection.api<Res>(path, options, session, transaction, { signal })
                        : this.#connection.apiAs<Res>(path, options, session, transaction, {
                              signal,
                              credential,
                          }),
                    signal,
                );
            } finally {
                request.dispose();
            }
        } finally {
            scope.dispose();
        }
    }

    #build(options: ApiOptions<Req> = this.#options): Query<[ApiResponse<Res>], J> {
        const { path, body, method, headers, query, transaction, session, json } = options;

        return new Query(this.#connection, {
            credential: this.#options.credential,
            transaction,
            json,
            session,
            query: surql`api::invoke(${path}, ${{
                body,
                method,
                headers,
                query,
            }})`,
            signals: this.#options.signals,
            requestTimeout: this.#options.requestTimeout,
        });
    }
}

function isSuccessful(status: number): boolean {
    return status >= 200 && status < 300;
}
