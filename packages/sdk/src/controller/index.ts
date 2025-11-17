import { createRemoteEngines } from "../engine";

import {
    AuthenticationError,
    ConnectionUnavailableError,
    InvalidSessionError,
    SurrealError,
    UnavailableFeatureError,
    UnsupportedEngineError,
    UnsupportedFeatureError,
    UnsupportedVersionError,
} from "../errors";
import type { Feature } from "../internal/feature";
import { ReconnectContext } from "../internal/reconnect";
import { fastParseJwt } from "../internal/tokens";
import type {
    AccessRecordAuth,
    AnyAuth,
    AuthProvider,
    ConnectionSession,
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
    Session,
    SqlExportOptions,
    SurrealEngine,
    SurrealProtocol,
    Token,
    Tokens,
    VersionInfo,
} from "../types";
import {
    type BoundQuery,
    Features,
    isVersionSupported,
    MAXIMUM_VERSION,
    MINIMUM_VERSION,
    Publisher,
} from "../utils";
import { getSessionFromState } from "../utils/get-session-from-state";
import { Uuid } from "../value";

type ConnectionEvents = {
    connecting: [];
    connected: [string];
    disconnected: [];
    reconnecting: [];
    error: [Error];
    auth: [Tokens | null, Session];
    using: [NamespaceDatabase, Session];
};

export class ConnectionController implements SurrealProtocol, EventPublisher<ConnectionEvents> {
    #eventPublisher = new Publisher<ConnectionEvents>();
    #context: DriverContext;
    #state: ConnectionState | undefined;
    #engine: SurrealEngine | undefined;
    #nextEngine: SurrealEngine | undefined;
    #status: ConnectionStatus = "disconnected";
    #authProvider: AuthProvider | undefined;
    #cachedVersion: string | undefined;

    #skipRenewal = false;
    #checkVersion = false;

    subscribe<K extends keyof ConnectionEvents>(
        event: K,
        listener: (...payload: ConnectionEvents[K]) => void,
    ): () => void {
        return this.#eventPublisher.subscribe(event, listener);
    }

    constructor(context: DriverContext) {
        this.#context = context;
    }

    public get state(): ConnectionState | undefined {
        return this.#state;
    }

    public get status(): ConnectionStatus {
        return this.#status;
    }

    propagateError(error: Error): void {
        this.#eventPublisher.publish("error", error);
    }

    // =========================================================== //
    //                                                             //
    //                    Connection Management                    //
    //                                                             //
    // =========================================================== //

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
        this.#skipRenewal = options.invalidateOnExpiry ?? false;
        this.#checkVersion = options.versionCheck ?? true;
        this.#state = {
            url,
            sessions: new Map(),
            reconnect: new ReconnectContext(options.reconnect),
            rootSession: {
                ...this.#createSessionState(undefined),
                namespace: options.namespace,
                database: options.database,
            },
        };

        this.#engine.subscribe("connected", () => this.#onConnected());
        this.#engine.subscribe("disconnected", () => this.#onDisconnected());
        this.#engine.subscribe("reconnecting", () => this.#onReconnecting());

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

    public async ready(): Promise<void> {
        if (this.#status === "disconnected") {
            throw new ConnectionUnavailableError();
        }

        if (this.#status === "connected") {
            return;
        }

        const [result] = await this.#eventPublisher.subscribeFirst("connected", "error");

        if (result instanceof Error) {
            throw result;
        }
    }

    public assertFeature(feature: Feature): void {
        if (!this.#engine || !this.#cachedVersion) throw new ConnectionUnavailableError();

        if (!this.#engine.features.has(feature)) {
            throw new UnsupportedFeatureError(feature);
        }

        if (!feature.supports(this.#cachedVersion)) {
            throw new UnavailableFeatureError(feature, this.#cachedVersion);
        }
    }

    #instanceEngine(url: URL): SurrealEngine {
        const engineMap = this.#context.options.engines ?? createRemoteEngines();
        const protocol = url.protocol.slice(0, -1);
        const factory = engineMap[protocol];

        if (!factory) {
            throw new UnsupportedEngineError(protocol);
        }

        return factory(this.#context);
    }

    // =========================================================== //
    //                                                             //
    //                      Protocol Wrappers                      //
    //                                                             //
    // =========================================================== //

    health(): Promise<void> {
        if (!this.#engine) throw new ConnectionUnavailableError();
        return this.#engine?.health();
    }

    version(): Promise<VersionInfo> {
        if (!this.#engine) throw new ConnectionUnavailableError();
        return this.#engine.version();
    }

    async sessions(): Promise<Uuid[]> {
        if (!this.#engine) throw new ConnectionUnavailableError();

        this.assertFeature(Features.Sessions);

        return this.#engine.sessions();
    }

    async signup(auth: AccessRecordAuth, session: Session, skipOverride = false): Promise<Tokens> {
        if (!this.#engine || !this.#state) {
            throw new ConnectionUnavailableError();
        }

        const response = await this.#engine.signup(auth, session);
        const sessionState = this.getSession(session);

        sessionState.accessToken = response.access;
        sessionState.refreshToken = response.refresh;
        sessionState.authOverriden = sessionState.authOverriden || !skipOverride;
        this.#handleAuthChanged(session);

        return response;
    }

    async signin(auth: AnyAuth, session: Session, skipOverride = false): Promise<Tokens> {
        if (!this.#engine || !this.#state) {
            throw new ConnectionUnavailableError();
        }

        const response = await this.#engine.signin(auth, session);
        const sessionState = this.getSession(session);

        sessionState.accessToken = response.access;
        sessionState.refreshToken = response.refresh;
        sessionState.authOverriden = sessionState.authOverriden || !skipOverride;
        this.#handleAuthChanged(session);

        return response;
    }

    async authenticate(token: Token, session: Session, skipOverride = false): Promise<void> {
        if (!this.#engine || !this.#state) {
            throw new ConnectionUnavailableError();
        }

        await this.#engine.authenticate(token, session);
        const sessionState = this.getSession(session);

        sessionState.accessToken = token;
        sessionState.authOverriden = sessionState.authOverriden || !skipOverride;
        this.#handleAuthChanged(session);
    }

    async refresh(tokens: Tokens, session: Session, skipOverride = false): Promise<Tokens> {
        if (!this.#engine || !this.#state) {
            throw new ConnectionUnavailableError();
        }

        this.assertFeature(Features.RefreshTokens);

        const response = await this.#engine.refresh(tokens, session);
        const sessionState = this.getSession(session);

        sessionState.accessToken = response.access;
        sessionState.refreshToken = response.refresh;
        sessionState.authOverriden = sessionState.authOverriden || !skipOverride;
        this.#handleAuthChanged(session);

        return response;
    }

    async revoke(tokens: Tokens, session: Session): Promise<void> {
        if (!this.#engine || !this.#state) {
            throw new ConnectionUnavailableError();
        }

        this.assertFeature(Features.RefreshTokens);

        await this.#engine.revoke(tokens, session);
    }

    async use(what: Nullable<NamespaceDatabase>, session: Session): Promise<void> {
        if (!this.#engine || !this.#state) {
            throw new ConnectionUnavailableError();
        }

        if (what.namespace === null && what.database !== null) {
            throw new SurrealError("Cannot unset namespace without unsetting database");
        }

        await this.#engine.use(what, session);

        const { namespace, database } = what;
        const sessionState = this.getSession(session);

        if (namespace === null) sessionState.namespace = undefined;
        if (database === null) sessionState.database = undefined;
        if (namespace) sessionState.namespace = namespace;
        if (database) sessionState.database = database;

        const selected: NamespaceDatabase = {
            namespace: sessionState.namespace,
            database: sessionState.database,
        };

        this.#eventPublisher.publish("using", selected, session);
    }

    async set(name: string, value: unknown, session: Session): Promise<void> {
        if (!this.#engine || !this.#state) {
            throw new ConnectionUnavailableError();
        }

        await this.#engine.set(name, value, session);
        const sessionState = this.getSession(session);

        sessionState.variables[name] = value;
    }

    async unset(name: string, session: Session): Promise<void> {
        if (!this.#engine || !this.#state) {
            throw new ConnectionUnavailableError();
        }

        await this.#engine.unset(name, session);
        const sessionState = this.getSession(session);

        delete sessionState.variables[name];
    }

    async invalidate(session: Session): Promise<void> {
        if (!this.#engine) throw new ConnectionUnavailableError();
        await this.#engine.invalidate(session);
        this.#handleAuthInvalidate(session);
    }

    async reset(session: Session): Promise<void> {
        if (!this.#engine || !this.#state) {
            throw new ConnectionUnavailableError();
        }

        await this.#engine.reset(session);
        const sessionState = this.getSession(session);

        sessionState.namespace = undefined;
        sessionState.database = undefined;
        sessionState.variables = {};
        this.#handleAuthInvalidate(session);

        const payload: NamespaceDatabase = {
            namespace: undefined,
            database: undefined,
        };

        this.#eventPublisher.publish("using", payload, session);
    }

    begin(session: Session): Promise<Uuid> {
        if (!this.#engine) throw new ConnectionUnavailableError();
        this.assertFeature(Features.Transactions);
        return this.#engine.begin(session);
    }

    commit(txn: Uuid, session: Session): Promise<void> {
        if (!this.#engine) throw new ConnectionUnavailableError();
        this.assertFeature(Features.Transactions);
        return this.#engine.commit(txn, session);
    }

    cancel(txn: Uuid, session: Session): Promise<void> {
        if (!this.#engine) throw new ConnectionUnavailableError();
        this.assertFeature(Features.Transactions);
        return this.#engine.cancel(txn, session);
    }

    importSql(data: string): Promise<void> {
        if (!this.#engine) throw new ConnectionUnavailableError();
        return this.#engine.importSql(data);
    }

    exportSql(options: Partial<SqlExportOptions>): Promise<string> {
        if (!this.#engine) throw new ConnectionUnavailableError();
        return this.#engine.exportSql(options);
    }

    exportMlModel(options: MlExportOptions): Promise<Uint8Array> {
        if (!this.#engine) throw new ConnectionUnavailableError();
        return this.#engine.exportMlModel(options);
    }

    query<T>(query: BoundQuery, session: Session, txn?: Uuid): AsyncIterable<QueryChunk<T>> {
        if (!this.#engine) throw new ConnectionUnavailableError();
        return this.#engine.query(query, session, txn);
    }

    liveQuery(id: Uuid): AsyncIterable<LiveMessage> {
        if (!this.#engine) throw new ConnectionUnavailableError();
        return this.#engine.liveQuery(id);
    }

    // =========================================================== //
    //                                                             //
    //                       Status Callbacks                      //
    //                                                             //
    // =========================================================== //

    async #onConnected(): Promise<void> {
        try {
            const { version } = await this.version();

            // Cache the version for feature checks
            this.#cachedVersion = version;

            // Perform version check
            if (this.#checkVersion && !isVersionSupported(version)) {
                throw new UnsupportedVersionError(version, MINIMUM_VERSION, MAXIMUM_VERSION);
            }

            // Restore all previous sessions
            for (const session of this.#allSessions()) {
                await this.#restoreSession(session);
            }

            this.#status = "connected";
            this.#eventPublisher.publish("connected", version);
        } catch (err: unknown) {
            this.#eventPublisher.publish("error", err as Error);
            this.#engine?.close();
            return;
        }
    }

    #onDisconnected(): void {
        for (const session of this.#allSessions()) {
            this.#cancelAuthRenewal(session.id);
        }

        this.#state = undefined;
        this.#engine = undefined;
        this.#status = "disconnected";
        this.#eventPublisher.publish("disconnected");
    }

    #onReconnecting(): void {
        this.#status = "reconnecting";
        this.#eventPublisher.publish("reconnecting");
    }

    // =========================================================== //
    //                                                             //
    //                   Authentication Handling                   //
    //                                                             //
    // =========================================================== //

    #getTokens(session: Session): Tokens | undefined {
        const sessionState = this.getSession(session);

        if (!sessionState.accessToken) {
            return undefined;
        }

        return {
            access: sessionState.accessToken,
            refresh: sessionState.refreshToken,
        };
    }

    async #applyAuthProvider(session: Session): Promise<boolean> {
        const provider = this.#authProvider;

        if (!provider) {
            return false;
        }

        const computed = typeof provider === "function" ? await provider(session) : provider;

        if (computed === null) {
            return false;
        }

        if (typeof computed === "string") {
            await this.authenticate(computed, session, true);
        } else {
            await this.signin(computed, session, true);
        }

        return true;
    }

    #cancelAuthRenewal(session: Session): void {
        if (!this.#state) return;
        const sessionState = this.getSession(session);
        if (!sessionState.authRenewal) return;
        clearTimeout(sessionState.authRenewal);
        sessionState.authRenewal = undefined;
    }

    #handleAuthChanged(session: Session): void {
        if (!this.#state) return;

        const sessionState = this.getSession(session);
        const tokens = this.#getTokens(session);

        if (!tokens) return;

        this.#cancelAuthRenewal(session);
        this.#eventPublisher.publish("auth", tokens, session);

        // Schedule token renewal
        const payload = fastParseJwt(tokens.access);

        if (!payload || !payload.exp) return;

        // Renew 60 seconds before expiry
        const now = Math.floor(Date.now() / 1000);
        const delay = Math.max((payload.exp - now - 60) * 1000, 0);

        sessionState.authRenewal = setTimeout(() => {
            this.#applyAuthentication(session).catch((err) => {
                this.#eventPublisher.publish("error", new AuthenticationError(err));
            });
        }, delay);
    }

    async #abortAuthentication(session: Session): Promise<void> {
        if (!this.#state) return;

        const sessionState = this.getSession(session);

        if (sessionState.accessToken) {
            await this.invalidate(session);
        }
    }

    async #applyAuthentication(session: Session): Promise<void> {
        const sessionState = this.getSession(session);

        // Skip renewal if requested
        if (this.#skipRenewal) {
            await this.#abortAuthentication(session);
            return;
        }

        // Attempt to reuse the previous access token
        if (sessionState.accessToken) {
            const payload = fastParseJwt(sessionState.accessToken);

            if (payload?.exp) {
                const now = Math.floor(Date.now() / 1000);
                const isValid = payload.exp - now > 60;

                if (isValid) {
                    try {
                        await this.authenticate(sessionState.accessToken, session, true);
                        return;
                    } catch {
                        // Access token was not valid
                    }
                }
            }
        }

        // Attempt to issue a new access token
        if (sessionState.refreshToken) {
            const tokens = this.#getTokens(session);

            if (tokens) {
                try {
                    await this.refresh(tokens, session, true);
                    return;
                } catch {
                    // Refresh token was not valid
                }
            }
        }

        // Attempt to invoke the authentication provider
        if (!sessionState.authOverriden) {
            const applied = await this.#applyAuthProvider(session);

            if (applied) {
                return;
            }
        }

        // Options exhausted, abort the authentication
        await this.#abortAuthentication(session);
    }

    #handleAuthInvalidate(session: Session): void {
        if (!this.#state) return;
        const sessionState = this.getSession(session);

        sessionState.accessToken = undefined;
        sessionState.refreshToken = undefined;

        this.#cancelAuthRenewal(session);
        this.#eventPublisher.publish("auth", null, session);
    }

    // =========================================================== //
    //                                                             //
    //                      Session Management                     //
    //                                                             //
    // =========================================================== //

    hasSession(session: Session): boolean {
        if (!this.#state) return false;
        if (session === undefined) return true;
        return this.#state.sessions.has(session);
    }

    getSession(session: Session): ConnectionSession {
        if (!this.#state) throw new ConnectionUnavailableError();
        return getSessionFromState(this.#state, session);
    }

    async createSession(clone: Session | null): Promise<Session> {
        if (!this.#state) throw new ConnectionUnavailableError();

        this.assertFeature(Features.Sessions);

        const sessionId = Uuid.v4();

        if (clone === null) {
            this.#state.sessions.set(sessionId, this.#createSessionState(sessionId));
        } else {
            const state = this.#cloneSessionState(sessionId, clone);
            this.#state.sessions.set(sessionId, state);
            await this.#restoreSession(state);
        }

        return sessionId;
    }

    async destroySession(session: Session): Promise<void> {
        if (!this.#state) throw new ConnectionUnavailableError();

        if (!session || !this.#state.sessions.has(session)) {
            throw new InvalidSessionError(session);
        }

        await this.reset(session);

        this.#state.sessions.delete(session);
    }

    #allSessions(): ConnectionSession[] {
        if (!this.#state) return [];
        return [this.#state.rootSession, ...Array.from(this.#state.sessions.values())];
    }

    #createSessionState(id: Session): ConnectionSession {
        return {
            id,
            variables: {},
            namespace: undefined,
            database: undefined,
            accessToken: undefined,
            refreshToken: undefined,
            authRenewal: undefined,
            authOverriden: false,
        };
    }

    #cloneSessionState(newId: Session, existingId: Session): ConnectionSession {
        const state = this.getSession(existingId);

        return {
            id: newId,
            variables: { ...state.variables },
            namespace: state.namespace,
            database: state.database,
            accessToken: state.accessToken,
            refreshToken: state.refreshToken,
            authRenewal: undefined,
            authOverriden: false,
        };
    }

    async #restoreSession(session: ConnectionSession): Promise<void> {
        // Apply selected namespace and database
        if (session.namespace || session.database) {
            const what: NamespaceDatabase = {
                namespace: session.namespace,
                database: session.database,
            };

            await this.use(what, session.id);
        }

        // Apply defined variables
        for (const [name, value] of Object.entries(session.variables)) {
            await this.set(name, value, session.id);
        }

        // Apply authentication
        await this.#applyAuthentication(session.id);
    }
}
