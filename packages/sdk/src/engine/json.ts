import { ConnectionUnavailable } from "../errors";
import { buildRpcAuth } from "../internal/build-rpc-auth";
import { fetchSurreal } from "../internal/http";
import type {
    AccessRecordAuth,
    AnyAuth,
    AuthResponse,
    ConnectionState,
    DriverContext,
    LiveMessage,
    MlExportOptions,
    NamespaceDatabase,
    QueryChunk,
    RpcQueryResult,
    RpcRequest,
    SqlExportOptions,
    SurrealProtocol,
    Token,
    VersionInfo,
} from "../types";
import type { BoundQuery } from "../utils";
import { Duration, type Uuid } from "../value";

/**
 * JSON-based engines implement the SurrealDB v1 protocol, which uses
 * JSON objects to communicate with the server.
 */
export abstract class JsonEngine implements SurrealProtocol {
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

    async signup(auth: AccessRecordAuth): Promise<AuthResponse> {
        if (!this._state) {
            throw new ConnectionUnavailable();
        }

        const token: string = await this.send({
            method: "signup",
            params: [buildRpcAuth(this._state, auth)],
        });

        return {
            token,
        };
    }

    async signin(auth: AnyAuth): Promise<AuthResponse> {
        if (!this._state) {
            throw new ConnectionUnavailable();
        }

        const token: string = await this.send({
            method: "signin",
            params: [buildRpcAuth(this._state, auth)],
        });

        return {
            token,
        };
    }

    async authenticate(token: Token): Promise<void> {
        await this.send({
            method: "authenticate",
            params: [token],
        });
    }

    async use(what: Partial<NamespaceDatabase>): Promise<NamespaceDatabase> {
        await this.send({
            method: "use",
            params: [what.namespace, what.database],
        });

        return {
            namespace: what.namespace ?? null,
            database: what.database ?? null,
        };
    }

    async set(name: string, value: unknown): Promise<void> {
        await this.send({
            method: "let",
            params: [name, value],
        });
    }

    async unset(name: string): Promise<void> {
        await this.send({
            method: "unset",
            params: [name],
        });
    }

    async invalidate(): Promise<void> {
        await this.send({
            method: "invalidate",
        });
    }

    async reset(): Promise<void> {
        await this.send({
            method: "reset",
        });
    }

    async importSql(data: string): Promise<void> {
        if (!this._state) {
            throw new ConnectionUnavailable();
        }

        const endpoint = new URL(this._state.url);
        const basepath = endpoint.pathname.slice(0, -4);

        endpoint.pathname = `${basepath}/import`;

        await fetchSurreal(this._context, this._state, {
            body: data,
            url: endpoint,
            headers: {
                Accept: "application/json",
            },
        });
    }

    async exportSql(options: SqlExportOptions): Promise<string> {
        if (!this._state) {
            throw new ConnectionUnavailable();
        }

        const endpoint = new URL(this._state.url);
        const basepath = endpoint.pathname.slice(0, -4);

        endpoint.pathname = `${basepath}/export`;

        const buffer = await fetchSurreal(this._context, this._state, {
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
            throw new ConnectionUnavailable();
        }

        const endpoint = new URL(this._state.url);
        const basepath = endpoint.pathname.slice(0, -4);

        endpoint.pathname = `${basepath}/ml/export/${options.name}/${options.version}`;

        return await fetchSurreal(this._context, this._state, {
            url: endpoint,
            method: "GET",
        });
    }

    async *query<T>(query: BoundQuery): AsyncIterable<QueryChunk<T>> {
        const responses: RpcQueryResult[] = await this.send({
            method: "query",
            params: [query.query, query.bindings],
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

    abstract send<Method extends string, Params extends unknown[] | undefined, Result>(
        request: RpcRequest<Method, Params>,
    ): Promise<Result>;
}
