import { ConnectionUnavailableError, UnexpectedServerResponseError } from "../errors";
import { buildRpcAuth } from "../internal/build-rpc-auth";
import { getSessionFromState } from "../internal/get-session-from-state";
import { fetchSurreal } from "../internal/http";
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
import { Duration, type Uuid } from "../value";

/**
 * JSON-based engines implement the SurrealDB v1 protocol, which uses
 * JSON objects to communicate with the server.
 */
export abstract class RpcEngine implements SurrealProtocol {
    protected _context: DriverContext;
    protected _state: ConnectionState | undefined;

    constructor(context: DriverContext) {
        this._context = context;
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

    async use(what: Nullable<NamespaceDatabase>, session: Session): Promise<void> {
        await this.send({
            method: "use",
            params: [what.namespace, what.database],
            session,
        });
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

    async importSql(data: string): Promise<void> {
        if (!this._state) {
            throw new ConnectionUnavailableError();
        }

        const endpoint = new URL(this._state.url);
        const basepath = endpoint.pathname.slice(0, -4);

        endpoint.pathname = `${basepath}/import`;

        await fetchSurreal(this._context, this._state, this._state.rootSession, {
            body: data,
            url: endpoint,
            headers: {
                Accept: "application/json",
            },
        });
    }

    async exportSql(options: SqlExportOptions): Promise<string> {
        if (!this._state) {
            throw new ConnectionUnavailableError();
        }

        const endpoint = new URL(this._state.url);
        const basepath = endpoint.pathname.slice(0, -4);

        endpoint.pathname = `${basepath}/export`;

        const buffer = await fetchSurreal(this._context, this._state, this._state.rootSession, {
            body: options ?? {},
            url: endpoint,
            headers: {
                Accept: "plain/text",
            },
        });

        return new TextDecoder("utf-8").decode(buffer);
    }

    async exportMlModel(options: MlExportOptions): Promise<Uint8Array> {
        if (!this._state) {
            throw new ConnectionUnavailableError();
        }

        const endpoint = new URL(this._state.url);
        const basepath = endpoint.pathname.slice(0, -4);

        endpoint.pathname = `${basepath}/ml/export/${options.name}/${options.version}`;

        return await fetchSurreal(this._context, this._state, this._state.rootSession, {
            url: endpoint,
            method: "GET",
        });
    }

    async *query<T>(query: BoundQuery, session: Session): AsyncIterable<QueryChunk<T>> {
        const responses: RpcQueryResult[] = await this.send({
            method: "query",
            params: [query.query, query.bindings],
            session,
        });

        let index = 0;

        for (const response of responses) {
            const chunk: QueryChunk<T> = {
                query: index++,
                batch: 0,
                kind: "single",
                stats: {
                    bytesReceived: -1,
                    bytesScanned: -1,
                    recordsReceived: -1,
                    recordsScanned: -1,
                    duration: new Duration(response.time),
                },
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
                chunk.error = {
                    code: Number(response.result) || 0,
                    message: String(response.result),
                };
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

    abstract send<Method extends string, Params extends unknown[] | undefined, Result>(
        request: RpcRequest<Method, Params>,
    ): Promise<Result>;
}
