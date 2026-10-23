import { jsonify, type Uuid } from "@surrealdb/sqon";
import type { ApiRequest } from "../api/api";
import {
    ConnectionUnavailableError,
    HttpConnectionError,
    ImportError,
    MissingNamespaceDatabaseError,
    SurrealError,
    UnexpectedServerResponseError,
} from "../errors";
import { raceAbort, throwIfAborted } from "../internal/abort";
import { buildRpcAuth } from "../internal/build-rpc-auth";
import { getSessionFromState } from "../internal/get-session-from-state";
import { fetchSurreal, readBytes, releaseResponse } from "../internal/http";
import { parseQueryError, type RpcQueryResultErrRaw } from "../internal/parse-error";
import { statsFromTime } from "../internal/query-stats";
import { wrapSqonError } from "../internal/wrap-sqon-error";
import type { ApiResponse } from "../query/api";
import type {
    AccessRecordAuth,
    AnyAuth,
    ConnectionState,
    DriverContext,
    LiveMessage,
    MlExportOptions,
    NamespaceDatabase,
    Nullable,
    QueryChunk,
    RequestOptions,
    RpcQueryResult,
    RpcRequest,
    Session,
    SqlExportOptions,
    SurrealProtocol,
    Token,
    Tokens,
    VersionInfo,
} from "../types";
import type { BoundQuery } from "../utils";
import { isVersionSupported } from "../utils/is-version-supported";

/** From 3.1, the server answers an import with the statements which failed, and only those */
const IMPORT_REPORTS_FAILURES = "3.1.0";

/** The status from which the server says, for itself, that statements of an import failed */
const IMPORT_FAILED = 422;

/** The most failures an `ImportError` carries, beyond which they are only counted */
const KEPT_FAILURES = 100;

/** Custom API responses carry their own status, including application errors. */
const API_HTTP_STATUSES = Array.from({ length: 400 }, (_, index) => index + 200);

/**
 * JSON-based engines implement the SurrealDB v1 protocol, which uses
 * JSON objects to communicate with the server.
 */
export abstract class RpcEngine implements SurrealProtocol {
    protected _context: DriverContext;
    protected _state: ConnectionState | undefined;
    /** The version of the server, as `ready()` is told it */
    protected _version: string | undefined;

    constructor(context: DriverContext) {
        this._context = context;
    }

    async invokeApiHttp<T>(
        path: string,
        request: ApiRequest<unknown>,
        session: Session,
        options?: RequestOptions,
    ): Promise<ApiResponse<T>> {
        return this.invokeApiHttpWith(path, request, session, options);
    }

    protected async invokeApiHttpWith<T>(
        path: string,
        request: ApiRequest<unknown>,
        session: Session,
        options?: RequestOptions,
        token?: Token,
    ): Promise<ApiResponse<T>> {
        if (!this._state) throw new ConnectionUnavailableError();
        const state = this._state;
        const selected = getSessionFromState(state, session);
        if (!selected.namespace || !selected.database) throw new MissingNamespaceDatabaseError();
        if ([selected.namespace, selected.database].some((name) => name === "." || name === "..")) {
            throw new SurrealError("HTTP API namespace and database cannot be dot segments");
        }
        const method = (request.method ?? "get").toUpperCase();
        if ((method === "GET" || method === "HEAD") && request.body !== undefined) {
            throw new SurrealError("HTTP API requests with GET or HEAD cannot have a body");
        }

        const endpoint = new URL(state.url);
        const basepath = endpoint.pathname.slice(0, -4);
        // Encode every segment so path data cannot replace the origin, query, or fragment.
        const segments = path.split("/").filter(Boolean);
        if (segments.some((segment) => segment === "." || segment === "..")) {
            throw new SurrealError("HTTP API paths cannot contain dot segments");
        }
        endpoint.pathname = `${basepath}/api/${encodeURIComponent(selected.namespace)}/${encodeURIComponent(selected.database)}/${segments.map(encodeURIComponent).join("/")}`;
        endpoint.search = "";
        endpoint.hash = "";
        for (const [name, value] of Object.entries(request.query ?? {})) {
            endpoint.searchParams.set(name, value);
        }

        const requestHeaders = new Headers(request.headers);
        const requestType =
            requestHeaders.get("content-type")?.split(";", 1)[0].trim().toLowerCase() ??
            "application/cbor";
        let payload: Blob | undefined;
        if (request.body !== undefined) {
            if (request.body instanceof Blob) {
                payload = request.body;
            } else if (requestType === "application/cbor") {
                payload = new Blob([
                    new Uint8Array(
                        wrapSqonError(() => this._context.codecs.cbor.encode(request.body)),
                    ),
                ]);
            } else if (requestType === "application/json" || requestType.endsWith("+json")) {
                payload = new Blob([JSON.stringify(jsonify(request.body))]);
            } else if (typeof request.body === "string" || request.body instanceof Uint8Array) {
                payload = new Blob([request.body]);
            } else {
                throw new SurrealError(
                    "HTTP API bodies with this Content-Type must be a string, Uint8Array, or Blob",
                );
            }
        }
        const headers: Record<string, string> = {};
        requestHeaders.forEach((value, name) => {
            // Use the same spelling as fetchSurreal's defaults to replace them.
            headers[
                name === "content-type"
                    ? "Content-Type"
                    : name === "accept"
                      ? "Accept"
                      : name === "authorization"
                        ? "Authorization"
                        : name === "surreal-ns"
                          ? "Surreal-NS"
                          : name === "surreal-db"
                            ? "Surreal-DB"
                            : name
            ] = value;
        });
        const response = await fetchSurreal(this._context, state, selected, {
            url: endpoint,
            method,
            body: payload,
            headers,
            token,
            signal: options?.signal,
            // All HTTP statuses belong to the API response, including application errors.
            answers: API_HTTP_STATUSES,
            retryAuth: false,
            redirect: "manual",
        });
        const bytes = await readBytes(response, options?.signal);
        const contentType = response.headers
            .get("content-type")
            ?.split(";", 1)[0]
            .trim()
            .toLowerCase();
        let body: unknown;
        if (bytes.length === 0) {
            body = undefined;
        } else if (contentType === "application/cbor") {
            body = wrapSqonError(() => this._context.codecs.cbor.decode(bytes));
        } else if (contentType === "application/json" || contentType?.endsWith("+json")) {
            body = JSON.parse(new TextDecoder().decode(bytes));
        } else if (contentType?.startsWith("text/")) {
            body = new TextDecoder().decode(bytes);
        } else {
            body = bytes;
        }
        const responseHeaders: Record<string, string> = {};
        response.headers.forEach((value, name) => {
            responseHeaders[name] = value;
        });
        return { body: body as T, status: response.status, headers: responseHeaders };
    }

    async health(): Promise<void> {
        await this.send({ method: "health" });
    }

    async version(): Promise<VersionInfo> {
        const version: string = await this.send({ method: "version" });

        return {
            version,
        };
    }

    async sessions(): Promise<Uuid[]> {
        return await this.send({
            method: "sessions",
        });
    }

    async attach(session: Uuid): Promise<void> {
        await this.send({
            method: "attach",
            session,
        });
    }

    async detach(session: Uuid): Promise<void> {
        return await this.send({
            method: "detach",
            session,
        });
    }

    async use(what: Nullable<NamespaceDatabase>, session: Session): Promise<NamespaceDatabase> {
        const res = await this.send({
            method: "use",
            params: [what.namespace, what.database],
            session,
        });

        // 2.x will not return anything so lets fall back to an empty object
        return res ?? {};
    }

    async signup(auth: AccessRecordAuth, session: Session): Promise<Tokens> {
        if (!this._state) {
            throw new ConnectionUnavailableError();
        }

        const sessionState = getSessionFromState(this._state, session);
        const response = await this.send({
            method: "signup",
            params: [buildRpcAuth(sessionState, auth)],
            session,
        });

        return this.parseTokens(response);
    }

    async signin(auth: AnyAuth, session: Session): Promise<Tokens> {
        if (!this._state) {
            throw new ConnectionUnavailableError();
        }

        const sessionState = getSessionFromState(this._state, session);
        const response = await this.send({
            method: "signin",
            params: [buildRpcAuth(sessionState, auth)],
            session,
        });

        return this.parseTokens(response);
    }

    async authenticate(token: Token, session: Session): Promise<void> {
        await this.send({
            method: "authenticate",
            params: [token],
            session,
        });
    }

    async set(name: string, value: unknown, session: Session): Promise<void> {
        await this.send({
            method: "let",
            params: [name, value],
            session,
        });
    }

    async unset(name: string, session: Session): Promise<void> {
        await this.send({
            method: "unset",
            params: [name],
            session,
        });
    }

    async refresh(tokens: Tokens, session: Session): Promise<Tokens> {
        return this.parseTokens(
            await this.send({
                method: "refresh",
                params: [tokens],
                session,
            }),
        );
    }

    async revoke(tokens: Tokens, session: Session): Promise<void> {
        await this.send({
            method: "revoke",
            params: [tokens],
            session,
        });
    }

    async invalidate(session: Session): Promise<void> {
        await this.send({
            method: "invalidate",
            session,
        });
    }

    async reset(session: Session): Promise<void> {
        await this.send({
            method: "reset",
            session,
        });
    }

    async begin(session: Session): Promise<Uuid> {
        const result = await this.send({
            method: "begin",
            session,
        });

        return result as Uuid;
    }

    async commit(txn: Uuid, session: Session): Promise<void> {
        await this.send({
            method: "commit",
            params: [txn],
            session,
        });
    }

    async cancel(txn: Uuid, session: Session): Promise<void> {
        await this.send({
            method: "cancel",
            params: [txn],
            session,
        });
    }

    async importSql(data: string | Blob | ReadableStream, request?: RequestOptions): Promise<void> {
        await this.importWith(data, request);
    }

    async exportSql(
        options: Partial<SqlExportOptions>,
        request?: RequestOptions,
    ): Promise<Response> {
        return this.exportWith(options, request);
    }

    async exportMlModel(options: MlExportOptions, request?: RequestOptions): Promise<Response> {
        return this.exportMlModelWith(options, request);
    }

    /**
     * Import, presenting a token for this import alone when there is one, and otherwise the
     * credential of the connection, as it is for every request.
     */
    protected async importWith(
        data: string | Blob | ReadableStream,
        request: RequestOptions | undefined,
        token?: Token,
    ): Promise<void> {
        if (!this._state) {
            throw new ConnectionUnavailableError();
        }

        const endpoint = new URL(this._state.url);
        const basepath = endpoint.pathname.slice(0, -4);

        endpoint.pathname = `${basepath}/import`;

        // An older server answers with the result of every statement, which is left unread
        const reports =
            this._version !== undefined &&
            isVersionSupported(this._version, IMPORT_REPORTS_FAILURES);

        const response = await fetchSurreal(this._context, this._state, this._state.rootSession, {
            body: typeof data === "string" ? new Blob([data]) : data,
            url: endpoint,
            headers: {
                Accept: "application/json",
            },
            token,
            signal: request?.signal,
            uploadProgress: request?.uploadProgress,
            answers: reports ? [IMPORT_FAILED] : undefined,
        });

        if (!reports) {
            releaseResponse(response);
            return;
        }

        // The answer lists only the statements which failed, so it is small unless many did
        let results: unknown;

        try {
            results = await raceAbort(response.json(), request?.signal);
        } catch {
            throwIfAborted(request?.signal);
        }

        const failures = Array.isArray(results)
            ? (results as RpcQueryResultErrRaw[]).filter((result) => result?.status === "ERR")
            : [];

        if (failures.length > 0) {
            throw new ImportError(
                failures.slice(0, KEPT_FAILURES).map(parseQueryError),
                failures.length,
            );
        }

        if (response.status !== 200) {
            throw new HttpConnectionError(
                "The import failed",
                response.status,
                response.statusText,
                new ArrayBuffer(0),
            );
        }
    }

    /**
     * Export, presenting a token for this export alone when there is one. See `importWith()`.
     */
    protected async exportWith(
        options: Partial<SqlExportOptions>,
        request: RequestOptions | undefined,
        token?: Token,
    ): Promise<Response> {
        if (!this._state) {
            throw new ConnectionUnavailableError();
        }

        const endpoint = new URL(this._state.url);
        const basepath = endpoint.pathname.slice(0, -4);

        endpoint.pathname = `${basepath}/export`;

        return fetchSurreal(this._context, this._state, this._state.rootSession, {
            body: options ?? {},
            url: endpoint,
            headers: {
                Accept: "plain/text",
            },
            token,
            signal: request?.signal,
        });
    }

    /**
     * Export a model, presenting a token for this export alone when there is one. See
     * `importWith()`.
     */
    protected async exportMlModelWith(
        options: MlExportOptions,
        request: RequestOptions | undefined,
        token?: Token,
    ): Promise<Response> {
        if (!this._state) {
            throw new ConnectionUnavailableError();
        }

        const endpoint = new URL(this._state.url);
        const basepath = endpoint.pathname.slice(0, -4);

        endpoint.pathname = `${basepath}/ml/export/${options.name}/${options.version}`;

        return fetchSurreal(this._context, this._state, this._state.rootSession, {
            url: endpoint,
            method: "GET",
            token,
            signal: request?.signal,
        });
    }

    query<T>(
        query: BoundQuery,
        session: Session,
        txn?: Uuid,
        options?: RequestOptions,
    ): AsyncIterable<QueryChunk<T>> {
        return this.#dispatchQuery<T>("query", query, session, txn, options);
    }

    gql<T>(
        query: BoundQuery,
        session: Session,
        txn?: Uuid,
        options?: RequestOptions,
    ): AsyncIterable<QueryChunk<T>> {
        return this.#dispatchQuery<T>("gql", query, session, txn, options);
    }

    async *#dispatchQuery<T>(
        method: "query" | "gql",
        query: BoundQuery,
        session: Session,
        txn?: Uuid,
        options?: RequestOptions,
    ): AsyncIterable<QueryChunk<T>> {
        const responses: RpcQueryResult[] = await this.send(
            {
                method,
                params: [query.query, query.bindings],
                session,
                txn,
            },
            options,
        );

        yield* this.toChunks<T>(responses);
    }

    /**
     * Translate the statement results of a `query` request into chunks
     */
    protected *toChunks<T>(responses: RpcQueryResult[]): Iterable<QueryChunk<T>> {
        let index = 0;

        for (const response of responses) {
            const chunk: QueryChunk<T> = {
                query: index++,
                batch: 0,
                kind: "single",
                stats: statsFromTime(response.time),
            };

            if (response.status === "OK") {
                chunk.type = response.type;

                if (Array.isArray(response.result)) {
                    chunk.kind = "batched-final";
                    chunk.result = response.result as T[];
                } else {
                    chunk.result = [response.result] as T[];
                }
            } else {
                chunk.error = parseQueryError(response);
            }

            yield chunk;
        }
    }

    abstract liveQuery(id: Uuid): AsyncIterable<LiveMessage>;

    parseTokens(response: unknown): Tokens {
        if (typeof response === "string") {
            return {
                access: response,
                refresh: undefined,
            };
        }

        if (typeof response === "object") {
            return response as Tokens;
        }

        throw new UnexpectedServerResponseError(response);
    }

    /**
     * Send a request and resolve with its result.
     *
     * With a `signal` in the options, an engine stops waiting for the answer once it aborts, and
     * rejects with the reason of the signal.
     */
    abstract send<Method extends string, Params extends unknown[] | undefined, Result>(
        request: RpcRequest<Method, Params>,
        options?: RequestOptions,
    ): Promise<Result>;
}
