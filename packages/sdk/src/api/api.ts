import type { ConnectionController } from "../controller";
import { ApiPromise } from "../query/api";
import type {
    Session,
    SurrealApiDeletePaths,
    SurrealApiGetPaths,
    SurrealApiPatchPaths,
    SurrealApiPostPaths,
    SurrealApiPutPaths,
    SurrealApiTracePaths,
} from "../types";
import type { Uuid } from "../value";

export type Headers = Record<string, string>;

/**
 * The request information for an api request.
 */
export interface ApiRequest<T> {
    body?: T;
    method?: string;
    headers?: Headers;
    query?: Record<string, string>;
}

type Paths<T> = Extract<keyof T, string> | (string & {});
type ReqFor<T> = T extends keyof SurrealApiGetPaths ? SurrealApiGetPaths[T][0] : unknown;
type ResFor<T> = T extends keyof SurrealApiGetPaths ? SurrealApiGetPaths[T][1] : unknown;

/**
 * Exposes a set of methods to interact with user defined APIs.
 */
export class SurrealApi {
    readonly #connection: ConnectionController;
    readonly #transaction: Uuid | undefined;
    readonly #session: Session;
    readonly #headers: Headers;

    constructor(connection: ConnectionController, session: Session, transaction?: Uuid) {
        this.#connection = connection;
        this.#session = session;
        this.#transaction = transaction;
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
        return new ApiPromise(this.#connection, {
            path,
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
    get<P extends string = Paths<SurrealApiGetPaths>, Res = ResFor<P>>(
        path: P,
    ): ApiPromise<void, Res> {
        return this.invoke<void, Res>(path, {
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
    post<P extends string = Paths<SurrealApiPostPaths>, Req = ReqFor<P>, Res = ResFor<P>>(
        path: P,
        body?: Req,
    ): ApiPromise<Req, Res> {
        return this.invoke<Req, Res>(path, {
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
    put<P extends string = Paths<SurrealApiPutPaths>, Req = ReqFor<P>, Res = ResFor<P>>(
        path: P,
        body?: Req,
    ): ApiPromise<Req, Res> {
        return this.invoke<Req, Res>(path, {
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
    delete<P extends string = Paths<SurrealApiDeletePaths>, Req = ReqFor<P>, Res = ResFor<P>>(
        path: P,
        body?: Req,
    ): ApiPromise<Req, Res> {
        return this.invoke<Req, Res>(path, {
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
    patch<P extends string = Paths<SurrealApiPatchPaths>, Req = ReqFor<P>, Res = ResFor<P>>(
        path: P,
        body?: Req,
    ): ApiPromise<Req, Res> {
        return this.invoke<Req, Res>(path, {
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
    trace<P extends string = Paths<SurrealApiTracePaths>, Req = ReqFor<P>, Res = ResFor<P>>(
        path: P,
        body?: Req,
    ): ApiPromise<Req, Res> {
        return this.invoke<Req, Res>(path, {
            method: "trace",
            body,
        });
    }
}
