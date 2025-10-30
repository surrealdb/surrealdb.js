import { createRemoteEngines } from "../engine";

import {
    AuthenticationError,
    ConnectionUnavailableError,
    SurrealError,
    UnsupportedEngineError,
    UnsupportedFeatureError,
    UnsupportedVersionError,
} from "../errors";
import { getSessionFromState } from "../internal/get-session-from-state";
import { ReconnectContext } from "../internal/reconnect";
import { fastParseJwt } from "../internal/tokens";
import type {
    AccessRecordAuth,
    AnyAuth,
    AuthOrToken,
    AuthProvider,
    AuthRenewer,
    AuthResponse,
    ConnectionSession,
    ConnectionState,
    ConnectionStatus,
    ConnectOptions,
    DriverContext,
    EventPublisher,
    Feature,
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
    VersionInfo,
} from "../types";
import { type BoundQuery, isVersionSupported, MAXIMUM_VERSION, MINIMUM_VERSION } from "../utils";
import { Publisher } from "../utils/publisher";
import { Uuid } from "../value";

type ConnectionEvents = {
    connecting: [];
    connected: [];
    disconnected: [];
    reconnecting: [];
    error: [Error];
    authenticated: [Token, Session];
    invalidated: [Session];
    using: [NamespaceDatabase, Session];
    reset: [Session];
};

export class ConnectionController implements SurrealProtocol, EventPublisher<ConnectionEvents> {
    #eventPublisher = new Publisher<ConnectionEvents>();
    #context: DriverContext;
    #state: ConnectionState | undefined;
    #engine: SurrealEngine | undefined;
    #nextEngine: SurrealEngine | undefined;
    #status: ConnectionStatus = "disconnected";
    #authProvider: AuthProvider | undefined;
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
        this.#checkVersion = options.versionCheck ?? true;
        this.#renewAccess = options.renewAccess ?? true;
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
        for (const session of this.#allSessions()) {
            this.#destroySession(session.id);
        }

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

        const [error] = await this.#eventPublisher.subscribeFirst("connected", "error");

        if (error) {
            throw error;
        }
    }

    async #matchVersion(
        min?: string,
        until?: string,
    ): Promise<{ version: string; matches: boolean }> {
        const { version } = await this.version();
        const matches = isVersionSupported(version, min, until);

        return { version, matches };
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
        return this.#engine.sessions();
    }

    async signup(auth: AccessRecordAuth, session: Session): Promise<AuthResponse> {
        if (!this.#engine || !this.#state) {
            throw new ConnectionUnavailableError();
        }

        const response = await this.#engine.signup(auth, session);
        const sessionState = this.getSession(session);

        sessionState.accessToken = response.token;
        sessionState.refreshToken = response.refresh;
        this.#handleAuthUpdate(session);

        return response;
    }

    async signin(auth: AnyAuth, session: Session): Promise<AuthResponse> {
        if (!this.#engine || !this.#state) {
            throw new ConnectionUnavailableError();
        }

        const response = await this.#engine.signin(auth, session);
        const sessionState = this.getSession(session);

        sessionState.accessToken = response.token;
        sessionState.refreshToken = response.refresh;
        this.#handleAuthUpdate(session);

        return response;
    }

    async authenticate(token: Token, session: Session): Promise<void> {
        if (!this.#engine || !this.#state) {
            throw new ConnectionUnavailableError();
        }

        await this.#engine.authenticate(token, session);
        const sessionState = this.getSession(session);

        sessionState.accessToken = token;
        this.#handleAuthUpdate(session);
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

        if (session === undefined) {
            this.#state.rootSession.namespace = undefined;
            this.#state.rootSession.database = undefined;
            this.#state.rootSession.variables = {};
            this.#handleAuthInvalidate(session);
            this.#eventPublisher.publish("reset", session);
        } else {
            this.#destroySession(session);
        }
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
            // Perform version check
            if (this.#checkVersion) {
                const { version, matches } = await this.#matchVersion();

                if (!matches) {
                    throw new UnsupportedVersionError(version, MINIMUM_VERSION, MAXIMUM_VERSION);
                }
            }

            // Restore all previous sessions
            for (const session of this.#allSessions()) {
                await this.#restoreSession(session);
            }

            this.#status = "connected";
            this.#eventPublisher.publish("connected");
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

    async #applyAuthOrToken(auth: AuthOrToken, session: Session): Promise<void> {
        if (typeof auth === "string") {
            await this.authenticate(auth, session);
        } else {
            await this.signin(auth, session);
        }
    }

    async #applyAuthProvider(session: Session): Promise<void> {
        const provider = this.#authProvider;
        if (!provider) return;

        await this.#applyAuthOrToken(
            typeof provider === "function" ? await provider(session) : provider,
            session,
        );
    }

    #handleAuthUpdate(session: Session): void {
        if (!this.#state) return;

        const sessionState = this.getSession(session);

        if (!sessionState.accessToken) return;

        this.#cancelAuthRenewal(session);
        this.#eventPublisher.publish("authenticated", sessionState.accessToken, session);

        const token = sessionState.accessToken;
        const payload = fastParseJwt(token);

        // Check expirey existance
        if (!payload || !payload.exp) return;

        // Renew 60 seconds before expiry
        const now = Math.floor(Date.now() / 1000);
        const delay = Math.max((payload.exp - now - 60) * 1000, 0);

        // Schedule next renewal or invalidation
        sessionState.authRenewal = setTimeout(() => {
            this.#renewAuth(session).catch((err) => {
                this.#eventPublisher.publish("error", new AuthenticationError(err));
            });
        }, delay);
    }

    async #renewAuth(session: Session): Promise<void> {
        if (this.#renewAccess === false) {
            this.#handleAuthInvalidate(session);
            return;
        }

        if (this.#renewAccess === true) {
            await this.#applyAuthProvider(session);
            return;
        }

        const auth = await this.#renewAccess(session);

        await this.#applyAuthOrToken(auth, session);
    }

    #handleAuthInvalidate(session: Session): void {
        if (!this.#state) return;
        const sessionState = this.getSession(session);

        sessionState.accessToken = undefined;
        sessionState.refreshToken = undefined;

        this.#cancelAuthRenewal(session);
        this.#eventPublisher.publish("invalidated", session);
    }

    #cancelAuthRenewal(session: Session): void {
        if (!this.#state) return;
        const sessionState = this.getSession(session);
        if (!sessionState.authRenewal) return;
        clearTimeout(sessionState.authRenewal);
        sessionState.authRenewal = undefined;
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

        const { matches } = await this.#matchVersion("3.0.0");

        if (!matches) {
            throw new SurrealError("Sessions are not supported with this version of SurrealDB");
        }

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
        };
    }

    #destroySession(session: Session): void {
        if (!this.#state || !session) return;

        this.#handleAuthInvalidate(session);
        this.#state.sessions.delete(session);
        this.#eventPublisher.publish("reset", session);
    }

    async #restoreSession(session: ConnectionSession): Promise<void> {
        let authRestored = false;

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

        // Attempt to re-authenticate the existing token
        if (session.accessToken) {
            const payload = fastParseJwt(session.accessToken);

            if (payload?.exp) {
                const now = Math.floor(Date.now() / 1000);
                const isValid = payload.exp - now > 60;

                if (isValid) {
                    await this.authenticate(session.accessToken, session.id);
                    authRestored = true;
                }
            }
        }

        // Renew the session
        if (!authRestored) {
            await this.#applyAuthProvider(session.id);
        }
    }
}
