import type { Feature } from "../internal/feature";
import type {
    AccessRecordAuth,
    AnyAuth,
    ConnectionState,
    Diagnostic,
    DiagnosticKey,
    DiagnosticResult,
    EngineEvents,
    LiveMessage,
    MlExportOptions,
    NamespaceDatabase,
    Nullable,
    QueryChunk,
    Session,
    SqlExportOptions,
    SurrealEngine,
    Token,
    Tokens,
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
            () => ({
                url: state.url,
            }),
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

    async sessions(): Promise<Uuid[]> {
        return this.#diagnose(
            "sessions",
            () => this.#delegate.sessions(),
            (list) => list,
        );
    }

    async use(what: Nullable<NamespaceDatabase>, session: Session): Promise<void> {
        return this.#diagnose(
            "use",
            () => this.#delegate.use(what, session),
            () => ({ requested: what, session }),
        );
    }

    async signup(auth: AccessRecordAuth, session: Session): Promise<Tokens> {
        return this.#diagnose(
            "signup",
            () => this.#delegate.signup(auth, session),
            () => ({ variant: "system_user", session }),
        );
    }

    async signin(auth: AnyAuth, session: Session): Promise<Tokens> {
        return this.#diagnose(
            "signin",
            () => this.#delegate.signin(auth, session),
            () => {
                const variant =
                    "key" in auth
                        ? "bearer_access"
                        : "variables" in auth
                          ? "record_access"
                          : "system_user";

                return { variant, session };
            },
        );
    }

    async authenticate(token: Token, session: Session): Promise<void> {
        return this.#diagnose(
            "authenticate",
            () => this.#delegate.authenticate(token, session),
            () => ({ variant: "token", session }),
        );
    }

    async set(name: string, value: unknown, session: Session): Promise<void> {
        return this.#diagnose(
            "set",
            () => this.#delegate.set(name, value, session),
            () => ({ name, value, session }),
        );
    }

    async unset(name: string, session: Session): Promise<void> {
        return this.#diagnose(
            "unset",
            () => this.#delegate.unset(name, session),
            () => ({ name, session }),
        );
    }

    async invalidate(session: Session): Promise<void> {
        return this.#diagnose(
            "invalidate",
            () => this.#delegate.invalidate(session),
            () => ({ session }),
        );
    }

    async refresh(tokens: Tokens, session: Session): Promise<Tokens> {
        return this.#diagnose(
            "refresh",
            () => this.#delegate.refresh(tokens, session),
            () => ({ session }),
        );
    }

    async revoke(tokens: Tokens, session: Session): Promise<void> {
        return this.#diagnose(
            "revoke",
            () => this.#delegate.revoke(tokens, session),
            () => ({ session }),
        );
    }

    async reset(session: Session): Promise<void> {
        return this.#diagnose(
            "reset",
            () => this.#delegate.reset(session),
            () => ({ session }),
        );
    }

    async begin(session: Session): Promise<Uuid> {
        return this.#diagnose(
            "begin",
            () => this.#delegate.begin(session),
            () => ({ session }),
        );
    }

    async commit(txn: Uuid, session: Session): Promise<void> {
        return this.#diagnose(
            "commit",
            () => this.#delegate.commit(txn, session),
            () => ({ txn, session }),
        );
    }

    async cancel(txn: Uuid, session: Session): Promise<void> {
        return this.#diagnose(
            "cancel",
            () => this.#delegate.cancel(txn, session),
            () => ({ txn, session }),
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

    query<T>(query: BoundQuery, session: Session, txn?: Uuid): AsyncIterable<QueryChunk<T>> {
        const measure = Duration.measure();
        const callback = this.#callback;
        const debugKey = Uuid.v4();

        callback({ type: "query", key: debugKey, phase: "before" });

        const delegateResult = this.#delegate.query(query, session, txn);

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
                                session,
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
                            session,
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
