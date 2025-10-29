import { createRemoteEngines } from "../engine";

import {
    AuthenticationFailed,
    ConnectionUnavailable,
    SurrealError,
    UnsupportedEngine,
} from "../errors";
import { ReconnectContext } from "../internal/reconnect";
import { fastParseJwt } from "../internal/tokens";
import type {
    AccessRecordAuth,
    AnyAuth,
    AuthOrToken,
    AuthProvider,
    AuthRenewer,
    AuthResponse,
    ConnectionState,
    ConnectionStatus,
    ConnectOptions,
    DriverContext,
    EventPublisher,
    LiveMessage,
    MlExportOptions,
    NamespaceDatabase,
    Nullable,
    QueryChunk,
    SqlExportOptions,
    SurrealEngine,
    SurrealProtocol,
    Token,
    VersionInfo,
} from "../types";
import { type BoundQuery, versionCheck } from "../utils";
import { Publisher } from "../utils/publisher";
import type { Uuid } from "../value";

type ConnectionEvents = {
    connecting: [];
    connected: [];
    disconnected: [];
    reconnecting: [];
    error: [Error];
    authenticated: [Token];
    invalidated: [];
    using: [NamespaceDatabase];
};

export class ConnectionController implements SurrealProtocol, EventPublisher<ConnectionEvents> {
    #eventPublisher = new Publisher<ConnectionEvents>();
    #context: DriverContext;
    #state: ConnectionState | undefined;
    #engine: SurrealEngine | undefined;
    #nextEngine: SurrealEngine | undefined;
    #status: ConnectionStatus = "disconnected";
    #authProvider: AuthProvider | undefined;
    #authRenewal: ReturnType<typeof setTimeout> | undefined;
    #renewAccess: AuthRenewer = false;
    #checkVersion = true;

    subscribe<K extends keyof ConnectionEvents>(
        event: K,
        listener: (...payload: ConnectionEvents[K]) => void,
    ): () => void {
        return this.#eventPublisher.subscribe(event, listener);
    }

    constructor(context: DriverContext) {
        this.#context = context;
    }

    public async connect(url: URL, options: ConnectOptions): Promise<true> {
        const engine = this.#instanceEngine(url);

        this.#nextEngine = engine;
        this.#status = "connecting";

        await this.disconnect();

        // Connect was called again synchronously. In this situation, we skip the
        // connection logic and return early.
        if (this.#nextEngine !== engine) {
            return true;
        }

        this.#engine = engine;
        this.#nextEngine = undefined;
        this.#authProvider = options.authentication;
        this.#checkVersion = options.versionCheck ?? true;
        this.#renewAccess = options.renewAccess ?? true;
        this.#state = {
            url,
            variables: {},
            namespace: options.namespace,
            database: options.database,
            accessToken: undefined,
            reconnect: new ReconnectContext(options.reconnect),
        };

        this.#engine.subscribe("connected", () => this.onConnected());
        this.#engine.subscribe("disconnected", () => this.onDisconnected());
        this.#engine.subscribe("reconnecting", () => this.onReconnecting());

        this.#status = "connecting";
        this.#eventPublisher.publish("connecting");
        this.#engine.open(this.#state);

        await this.ready();

        return true;
    }

    public async disconnect(): Promise<true> {
        if (this.#engine) {
            await this.#engine.close();
        }

        return true;
    }

    public get state(): ConnectionState | undefined {
        return this.#state;
    }

    public get status(): ConnectionStatus {
        return this.#status;
    }

    public async ready(): Promise<void> {
        if (this.#status === "disconnected") {
            throw new ConnectionUnavailable();
        }

        if (this.#status === "connected") {
            return;
        }

        const [error] = await this.#eventPublisher.subscribeFirst("connected", "error");

        if (error) {
            throw error;
        }
    }

    health(): Promise<void> {
        if (!this.#engine) throw new ConnectionUnavailable();
        return this.#engine?.health();
    }

    version(): Promise<VersionInfo> {
        if (!this.#engine) throw new ConnectionUnavailable();
        return this.#engine.version();
    }

    async signup(auth: AccessRecordAuth): Promise<AuthResponse> {
        if (!this.#engine || !this.#state) {
            throw new ConnectionUnavailable();
        }

        const response = await this.#engine.signup(auth);

        this.#state.accessToken = response.token;
        this.#state.refreshToken = response.refresh;
        this.handleAuthUpdate();

        return response;
    }

    async signin(auth: AnyAuth): Promise<AuthResponse> {
        if (!this.#engine || !this.#state) {
            throw new ConnectionUnavailable();
        }

        const response = await this.#engine.signin(auth);

        this.#state.accessToken = response.token;
        this.#state.refreshToken = response.refresh;
        this.handleAuthUpdate();

        return response;
    }

    async authenticate(token: Token): Promise<void> {
        if (!this.#engine || !this.#state) {
            throw new ConnectionUnavailable();
        }

        await this.#engine.authenticate(token);

        this.#state.accessToken = token;
        this.handleAuthUpdate();
    }

    async use(what: Nullable<NamespaceDatabase>): Promise<void> {
        if (!this.#engine || !this.#state) {
            throw new ConnectionUnavailable();
        }

        if (what.namespace === null && what.database !== null) {
            throw new SurrealError("Cannot unset namespace without unsetting database");
        }

        await this.#engine.use(what);

        const { namespace, database } = what;

        if (namespace === null) this.#state.namespace = undefined;
        if (database === null) this.#state.database = undefined;
        if (namespace) this.#state.namespace = namespace;
        if (database) this.#state.database = database;

        this.#eventPublisher.publish("using", {
            namespace: this.#state.namespace,
            database: this.#state.database,
        });
    }

    async set(name: string, value: unknown): Promise<void> {
        if (!this.#engine || !this.#state) {
            throw new ConnectionUnavailable();
        }

        await this.#engine.set(name, value);
        this.#state.variables[name] = value;
    }

    async unset(name: string): Promise<void> {
        if (!this.#engine || !this.#state) {
            throw new ConnectionUnavailable();
        }

        await this.#engine.unset(name);
        delete this.#state.variables[name];
    }

    async invalidate(): Promise<void> {
        if (!this.#engine) throw new ConnectionUnavailable();
        await this.#engine.invalidate();
        this.handleAuthInvalidate();
    }

    async reset(): Promise<void> {
        if (!this.#engine || !this.#state) {
            throw new ConnectionUnavailable();
        }

        await this.#engine.reset();
        this.#state.namespace = undefined;
        this.#state.database = undefined;
        this.#state.variables = {};
        this.handleAuthInvalidate();
        this.#eventPublisher.publish("using", {
            namespace: undefined,
            database: undefined,
        });
    }

    importSql(data: string): Promise<void> {
        if (!this.#engine) throw new ConnectionUnavailable();
        return this.#engine.importSql(data);
    }

    exportSql(options: Partial<SqlExportOptions>): Promise<string> {
        if (!this.#engine) throw new ConnectionUnavailable();
        return this.#engine.exportSql(options);
    }

    exportMlModel(options: MlExportOptions): Promise<Uint8Array> {
        if (!this.#engine) throw new ConnectionUnavailable();
        return this.#engine.exportMlModel(options);
    }

    query<T>(query: BoundQuery, txn?: Uuid): AsyncIterable<QueryChunk<T>> {
        if (!this.#engine) throw new ConnectionUnavailable();
        return this.#engine.query(query, txn);
    }

    liveQuery(id: Uuid): AsyncIterable<LiveMessage> {
        if (!this.#engine) throw new ConnectionUnavailable();
        return this.#engine.liveQuery(id);
    }

    private async onConnected(): Promise<void> {
        try {
            // Perform version check
            if (this.#checkVersion) {
                const { version } = await this.version();

                if (version) {
                    versionCheck(version);
                }
            }

            // Apply selected namespace and database
            if (this.#state?.namespace || this.#state?.database) {
                await this.use({
                    namespace: this.#state.namespace,
                    database: this.#state.database,
                });
            }

            // Apply authentication details
            await this.applyAuthProvider();

            this.#status = "connected";
            this.#eventPublisher.publish("connected");
        } catch (err: unknown) {
            this.#eventPublisher.publish("error", err as Error);
            this.#engine?.close();
            return;
        }
    }

    private onDisconnected(): void {
        this.#state = undefined;
        this.#engine = undefined;
        this.#status = "disconnected";
        this.#eventPublisher.publish("disconnected");
        this.cancelAuthRenewal();
    }

    private onReconnecting(): void {
        this.#status = "reconnecting";
        this.#eventPublisher.publish("reconnecting");
    }

    private async applyAuthOrToken(auth: AuthOrToken): Promise<void> {
        if (typeof auth === "string") {
            await this.authenticate(auth);
        } else {
            await this.signin(auth);
        }
    }

    private async applyAuthProvider(): Promise<void> {
        const provider = this.#authProvider;
        if (!provider) return;

        await this.applyAuthOrToken(typeof provider === "function" ? await provider() : provider);
    }

    private handleAuthUpdate(): void {
        if (!this.#state || !this.#state.accessToken) return;

        this.cancelAuthRenewal();
        this.#eventPublisher.publish("authenticated", this.#state.accessToken);

        const token = this.#state.accessToken;
        const payload = fastParseJwt(token);

        // Check expirey existance
        if (!payload || !payload.exp) return;

        // Renew 60 seconds before expiry
        const now = Math.floor(Date.now() / 1000);
        const delay = Math.max((payload.exp - now - 60) * 1000, 0);

        // Schedule next renewal or invalidation
        this.#authRenewal = setTimeout(() => {
            this.renewAuth().catch((err) => {
                this.#eventPublisher.publish("error", new AuthenticationFailed(err));
            });
        }, delay);
    }

    private async renewAuth(): Promise<void> {
        if (this.#renewAccess === false) {
            this.handleAuthInvalidate();
            return;
        }

        if (this.#renewAccess === true) {
            await this.applyAuthProvider();
            return;
        }

        const auth = await this.#renewAccess();

        await this.applyAuthOrToken(auth);
    }

    private handleAuthInvalidate(): void {
        if (!this.#state) return;
        this.#state.accessToken = undefined;
        this.#state.refreshToken = undefined;
        this.cancelAuthRenewal();
        this.#eventPublisher.publish("invalidated");
    }

    private cancelAuthRenewal(): void {
        if (this.#authRenewal === undefined) return;
        clearTimeout(this.#authRenewal);
        this.#authRenewal = undefined;
    }

    #instanceEngine(url: URL): SurrealEngine {
        const engineMap = this.#context.options.engines ?? createRemoteEngines();
        const protocol = url.protocol.slice(0, -1);
        const factory = engineMap[protocol];

        if (!factory) {
            throw new UnsupportedEngine(protocol);
        }

        return factory(this.#context);
    }
}
