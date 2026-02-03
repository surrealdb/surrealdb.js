import type { ConnectionController } from "../controller";
import { normalizePath } from "../internal/normalize-path";
import { ApiPromise } from "../query/api";
import type { Session } from "../types";
import { Features } from "../utils";
import type { Uuid } from "../value";

/**
 * The request information for an api request.
 */
export interface ApiRequest<T> {
    body?: T;
    method?: string;
    headers?: Record<string, string>;
    query?: Record<string, string>;
}

type HttpMethod = "get" | "post" | "put" | "delete" | "patch" | "trace";
type MethodDef = [unknown, unknown] | [];
type ValidPaths<TPaths> = Extract<keyof TPaths, string>;

/** A definition for a single API path */
export type PathDef = Partial<Record<HttpMethod, MethodDef>>;

/** Default paths type - allows any string with unknown bodies */
export type DefaultPaths = { [path: string]: PathDef };

// Extract method tuple for a path and method */
type ExtractMethod<TPaths, P extends string, M extends HttpMethod> = P extends keyof TPaths
    ? M extends keyof TPaths[P]
        ? TPaths[P][M]
        : never
    : never;

// Extract request body (index 0 of method tuple) */
type RequestBody<TPaths, P extends string, M extends HttpMethod> = ExtractMethod<
    TPaths,
    P,
    M
> extends [infer Req, unknown]
    ? Req
    : unknown;

// Extract response body (index 1 of method tuple) */
type ResponseBody<TPaths, P extends string, M extends HttpMethod> = ExtractMethod<
    TPaths,
    P,
    M
> extends [unknown, infer Res]
    ? Res
    : unknown;

/**
 * Exposes a set of methods to interact with user defined APIs.
 *
 * @example
 * ```ts
 * type MyPaths = {
 *     "/users": { get: [void, User[]] };
 *     "/projects": { get: [void, Project[]] };
 *     [K: `/users/${number}`]: { get: [void, User] };
 * };
 *
 * const api = db.api<MyPaths>();
 * api.get("/users");  // Returns ApiPromise<void, User[]>
 * ```
 */
export class SurrealApi<TPaths = DefaultPaths> {
    readonly #connection: ConnectionController;
    readonly #transaction: Uuid | undefined;
    readonly #prefix: string;
    readonly #session: Session;
    readonly #headers: Record<string, string>;

    constructor(
        connection: ConnectionController,
        session: Session,
        transaction?: Uuid,
        prefix?: string,
    ) {
        this.#connection = connection;
        this.#session = session;
        this.#transaction = transaction;
        this.#prefix = prefix ?? "";
        this.#headers = {};
    }

    /**
     * Configure a header for all requests sent by this API instance.
     *
     * This is useful for setting a common header for all requests sent by this API instance.
     *
     * @param name The name of the header to configure.
     * @param value The value of the header to configure, or null to remove the header.
     */
    header(name: string, value: string | null): void {
        if (value === null) {
            delete this.#headers[name];
        } else {
            this.#headers[name] = value;
        }
    }

    /**
     * Invoke a user defined API initialized with a request object.
     *
     * Prefer the method specific functions for a more type-safe experience.
     *
     * @param path The path of the API to invoke.
     * @param request The request to send to the API.
     * @returns The response from the API.
     */
    invoke<Req = unknown, Res = unknown>(
        path: string,
        request?: ApiRequest<Req>,
    ): ApiPromise<Req, Res> {
        this.#connection.assertFeature(Features.Api);

        return new ApiPromise(this.#connection, {
            path: normalizePath(this.#prefix, path),
            transaction: this.#transaction,
            session: this.#session,
            value: false,
            json: false,
            headers: { ...this.#headers, ...request?.headers },
            query: request?.query ?? {},
            method: request?.method ?? "get",
            body: request?.body,
        });
    }

    /**
     * Invoke a user defined GET API.
     *
     * @param path The path of the API to invoke.
     * @returns The response from the API.
     */
    get<P extends ValidPaths<TPaths>>(path: P): ApiPromise<void, ResponseBody<TPaths, P, "get">> {
        return this.invoke(path, {
            method: "get",
        });
    }

    /**
     * Invoke a user defined POST API.
     *
     * @param path The path of the API to invoke.
     * @param body The request body to send to the API.
     * @returns The response from the API.
     */
    post<P extends ValidPaths<TPaths>>(
        path: P,
        body?: RequestBody<TPaths, P, "post">,
    ): ApiPromise<RequestBody<TPaths, P, "post">, ResponseBody<TPaths, P, "post">> {
        return this.invoke(path, {
            method: "post",
            body,
        });
    }

    /**
     * Invoke a user defined PUT API.
     *
     * @param path The path of the API to invoke.
     * @param body The request body to send to the API.
     * @returns The response from the API.
     */
    put<P extends ValidPaths<TPaths>>(
        path: P,
        body?: RequestBody<TPaths, P, "put">,
    ): ApiPromise<RequestBody<TPaths, P, "put">, ResponseBody<TPaths, P, "put">> {
        return this.invoke(path, {
            method: "put",
            body,
        });
    }

    /**
     * Invoke a user defined DELETE API.
     *
     * @param path The path of the API to invoke.
     * @param body The request body to send to the API.
     * @returns The response from the API.
     */
    delete<P extends ValidPaths<TPaths>>(
        path: P,
        body?: RequestBody<TPaths, P, "delete">,
    ): ApiPromise<RequestBody<TPaths, P, "delete">, ResponseBody<TPaths, P, "delete">> {
        return this.invoke(path, {
            method: "delete",
            body,
        });
    }

    /**
     * Invoke a user defined PATCH API.
     *
     * @param path The path of the API to invoke.
     * @param body The request body to send to the API.
     * @returns The response from the API.
     */
    patch<P extends ValidPaths<TPaths>>(
        path: P,
        body?: RequestBody<TPaths, P, "patch">,
    ): ApiPromise<RequestBody<TPaths, P, "patch">, ResponseBody<TPaths, P, "patch">> {
        return this.invoke(path, {
            method: "patch",
            body,
        });
    }

    /**
     * Invoke a user defined TRACE API.
     *
     * @param path The path of the API to invoke.
     * @param body The request body to send to the API.
     * @returns The response from the API.
     */
    trace<P extends ValidPaths<TPaths>>(
        path: P,
        body?: RequestBody<TPaths, P, "trace">,
    ): ApiPromise<RequestBody<TPaths, P, "trace">, ResponseBody<TPaths, P, "trace">> {
        return this.invoke(path, {
            method: "trace",
            body,
        });
    }
}
