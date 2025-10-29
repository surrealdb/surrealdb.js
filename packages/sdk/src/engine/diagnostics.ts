import type {
    AccessRecordAuth,
    AnyAuth,
    AuthResponse,
    ConnectionState,
    Diagnostic,
    DiagnosticKey,
    DiagnosticResult,
    EngineEvents,
    Feature,
    LiveMessage,
    MlExportOptions,
    NamespaceDatabase,
    Nullable,
    QueryChunk,
    SqlExportOptions,
    SurrealEngine,
    Token,
    VersionInfo,
} from "../types";
import type { BoundQuery } from "../utils";
import { Duration, Uuid } from "../value";

export type DiagnosticsCallback = (event: Diagnostic) => void;

/**
 * The DiagnosticsEngine is a utility allowing you to intercept low level communication
 * within the SDK.
 */
export class DiagnosticsEngine implements SurrealEngine {
    readonly #delegate: SurrealEngine;
    readonly #callback: DiagnosticsCallback;

    constructor(delegate: SurrealEngine, callback: DiagnosticsCallback) {
        this.#delegate = delegate;
        this.#callback = callback;
    }

    get features(): Set<Feature> {
        return this.#delegate.features;
    }

    subscribe<K extends keyof EngineEvents>(
        event: K,
        listener: (...payload: EngineEvents[K]) => void,
    ): () => void {
        return this.#delegate.subscribe(event, listener);
    }

    open(state: ConnectionState): void {
        this.#diagnose(
            "open",
            () => Promise.resolve(this.#delegate.open(state)),
            () => undefined,
        );
    }

    async close(): Promise<void> {
        return this.#diagnose(
            "close",
            () => this.#delegate.close(),
            () => undefined,
        );
    }

    async health(): Promise<void> {
        return this.#diagnose(
            "health",
            () => this.#delegate.health(),
            () => undefined,
        );
    }

    async version(): Promise<VersionInfo> {
        return this.#diagnose(
            "version",
            () => this.#delegate.version(),
            (info) => info,
        );
    }

    async use(what: Nullable<NamespaceDatabase>): Promise<void> {
        return this.#diagnose(
            "use",
            () => this.#delegate.use(what),
            () => ({ requested: what }),
        );
    }

    async signup(auth: AccessRecordAuth): Promise<AuthResponse> {
        return this.#diagnose(
            "signup",
            () => this.#delegate.signup(auth),
            () => ({ variant: "system_user" }),
        );
    }

    async signin(auth: AnyAuth): Promise<AuthResponse> {
        return this.#diagnose(
            "signin",
            () => this.#delegate.signin(auth),
            () => {
                if ("key" in auth) {
                    return { variant: "bearer_access" };
                }

                if ("variables" in auth) {
                    return { variant: "record_access" };
                }

                return { variant: "system_user" };
            },
        );
    }

    async authenticate(token: Token): Promise<void> {
        return this.#diagnose(
            "authenticate",
            () => this.#delegate.authenticate(token),
            () => ({ variant: "token" }),
        );
    }

    async set(name: string, value: unknown): Promise<void> {
        return this.#diagnose(
            "set",
            () => this.#delegate.set(name, value),
            () => ({ name, value }),
        );
    }

    async unset(name: string): Promise<void> {
        return this.#diagnose(
            "unset",
            () => this.#delegate.unset(name),
            () => ({ name }),
        );
    }

    async invalidate(): Promise<void> {
        return this.#diagnose(
            "invalidate",
            () => this.#delegate.invalidate(),
            () => undefined,
        );
    }

    async reset(): Promise<void> {
        return this.#diagnose(
            "reset",
            () => this.#delegate.reset(),
            () => undefined,
        );
    }

    async importSql(data: string): Promise<void> {
        return this.#diagnose(
            "importSql",
            () => this.#delegate.importSql(data),
            () => undefined,
        );
    }

    async exportSql(options: Partial<SqlExportOptions>): Promise<string> {
        return this.#diagnose(
            "exportSql",
            () => this.#delegate.exportSql(options),
            () => undefined,
        );
    }

    async exportMlModel(options: MlExportOptions): Promise<Uint8Array> {
        return this.#diagnose(
            "exportMlModel",
            () => this.#delegate.exportMlModel(options),
            () => undefined,
        );
    }

    query<T>(query: BoundQuery, txn?: Uuid): AsyncIterable<QueryChunk<T>> {
        const measure = Duration.measure();
        const callback = this.#callback;
        const debugKey = Uuid.v4();

        callback({ type: "query", key: debugKey, phase: "before" });

        const delegateResult = this.#delegate.query(query, txn);

        return {
            async *[Symbol.asyncIterator]() {
                try {
                    for await (const chunk of delegateResult) {
                        callback({
                            type: "query",
                            key: debugKey,
                            phase: "progress",
                            result: {
                                query: query.query,
                                params: query.bindings,
                                transaction: txn,
                                chunk: chunk,
                            },
                        });

                        yield chunk as QueryChunk<T>;
                    }

                    callback({
                        type: "query",
                        key: debugKey,
                        phase: "after",
                        success: true,
                        duration: measure(),
                        result: {
                            query: query.query,
                            params: query.bindings,
                            transaction: txn,
                        },
                    });
                } catch (error) {
                    callback({
                        type: "query",
                        key: debugKey,
                        phase: "after",
                        success: false,
                        duration: measure(),
                        error: error as Error,
                    });

                    throw error;
                }
            },
        };
    }

    liveQuery(id: Uuid): AsyncIterable<LiveMessage> {
        const measure = Duration.measure();
        const callback = this.#callback;
        const debugKey = Uuid.v4();

        callback({ type: "liveQuery", key: debugKey, phase: "before" });

        const delegateResult = this.#delegate.liveQuery(id);

        return {
            async *[Symbol.asyncIterator]() {
                try {
                    for await (const message of delegateResult) {
                        callback({
                            type: "liveQuery",
                            key: debugKey,
                            phase: "progress",
                            result: { id, message },
                        });

                        yield message;
                    }

                    callback({
                        type: "liveQuery",
                        key: debugKey,
                        phase: "after",
                        success: true,
                        duration: measure(),
                        result: { id },
                    });
                } catch (error) {
                    callback({
                        type: "liveQuery",
                        key: debugKey,
                        phase: "after",
                        success: false,
                        duration: measure(),
                        error: error as Error,
                    });

                    throw error;
                }
            },
        };
    }

    async #diagnose<K extends DiagnosticKey, O>(
        type: K,
        callback: () => Promise<O>,
        result: (output: O) => DiagnosticResult<K>,
    ): Promise<O> {
        const measure = Duration.measure();
        const key = Uuid.v4();

        this.#callback({ type, key, phase: "before" });

        try {
            const response = await callback();

            this.#callback({
                type,
                key,
                phase: "after",
                success: true,
                duration: measure(),
                result: result(response),
            } as Diagnostic);

            return response;
        } catch (error) {
            this.#callback({
                type,
                key,
                phase: "after",
                success: false,
                duration: measure(),
                error: error as Error,
            });

            throw error;
        }
    }
}
