import type { Uuid } from "@surrealdb/sqon";
import {
    ConnectionUnavailableError,
    HttpConnectionError,
    ImportError,
    UnexpectedServerResponseError,
} from "../errors";
import { buildRpcAuth } from "../internal/build-rpc-auth";
import { getSessionFromState } from "../internal/get-session-from-state";
import { fetchSurreal, readChunks, releaseResponse } from "../internal/http";
import { ImportReportReader } from "../internal/import-report";
import { parseQueryError } from "../internal/parse-error";
import { statsFromTime } from "../internal/query-stats";
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

/**
 * JSON-based engines implement the SurrealDB v1 protocol, which uses
 * JSON objects to communicate with the server.
 */
export abstract class RpcEngine implements SurrealProtocol {
    protected _context: DriverContext;
    protected _state: ConnectionState | undefined;
    #version: string | undefined;

    constructor(context: DriverContext) {
        this._context = context;
    }

    async health(): Promise<void> {
        await this.send({ method: "health" });
    }

    async version(): Promise<VersionInfo> {
        const version: string = await this.send({ method: "version" });

        this.#version = version;

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
            this.#version !== undefined &&
            isVersionSupported(this.#version, IMPORT_REPORTS_FAILURES);

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
            discardSuccessBody: !reports,
        });

        if (!reports) {
            releaseResponse(response);
            return;
        }

        const reader = new ImportReportReader();

        await readChunks(response, request?.signal, (chunk) => reader.push(chunk));

        const report = reader.finish();

        if (report.failed > 0) {
            throw new ImportError(report.failures, report.failed, !report.complete);
        }

        if (response.status !== 200) {
            const buffer = new TextEncoder().encode(report.head).buffer as ArrayBuffer;
            throw new HttpConnectionError(
                report.head,
                response.status,
                response.statusText,
                buffer,
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
