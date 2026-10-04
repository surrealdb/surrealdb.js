import { Uuid } from "@surrealdb/sqon";
import { createRemoteEngines } from "../engine";
import {
    AuthenticationError,
    ConnectionUnavailableError,
    InvalidSessionError,
    MissingNamespaceDatabaseError,
    ServerError,
    UnavailableFeatureError,
    UnsupportedEngineError,
    UnsupportedFeatureError,
    UnsupportedVersionError,
} from "../errors";
import { assertCredential, invokeProvider, parseAuthentication } from "../internal/auth-provider";
import type { Feature } from "../internal/feature";
import { getSessionFromState } from "../internal/get-session-from-state";
import { ReconnectContext } from "../internal/reconnect";
import { RequestCredentials } from "../internal/request-credentials";
import { RetryContext } from "../internal/retry";
import { fastParseJwt, renewalDelay, tokenExpiry } from "../internal/tokens";
import type {
    AccessRecordAuth,
    AnyAuth,
    AuthCallable,
    AuthOrToken,
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
    ProvidedAuth,
    QueryChunk,
    RetryOptions,
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
    #authProvider: ProvidedAuth | AuthCallable | undefined;
    #requestResolver: AuthCallable | undefined;
    #requestAuth: RequestCredentials | undefined;
    #cachedVersion: string | undefined;
    #expiryMargin: number = 60;
    #skipRenewal: boolean = false;
    #checkVersion: boolean = false;

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
        const authentication = parseAuthentication(options.authentication);
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
        this.#skipRenewal = options.invalidateOnExpiry ?? false;
        this.#checkVersion = options.versionCheck ?? true;
        this.#expiryMargin = options.expiryMargin ?? 60;
        this.#authProvider = authentication.provider;
        this.#requestResolver = authentication.request?.resolve;
        this.#requestAuth = authentication.request
            ? new RequestCredentials({
                  cache: authentication.request.cache,
                  margin: () => this.#expiryMargin,
                  // A session held on the other side ends up with what was applied last
                  serialize: !engine.features.has(Features.PerRequestAuth),
              })
            : undefined;
        this.#state = {
            url,
            sessions: new Map(),
            reconnect: new ReconnectContext(options.reconnect),
            retry: RetryContext.mergeOptions(options.retry),
            rootSession: {
                ...this.#createSessionState(undefined),
                namespace: options.namespace,
                database: options.database,
            },
        };

        // Engines which present credentials with every request ask for them as they go, rather
        // than having them applied to a session
        if (this.#requestAuth && engine.features.has(Features.PerRequestAuth)) {
            this.#state.credentials = {
                token: (session, rejected) => this.#requestToken(session, rejected),
            };
        }

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

    public get retry(): RetryOptions {
        if (!this.#state) throw new ConnectionUnavailableError();

        return this.#state.retry;
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

    async attach(session: Uuid): Promise<void> {
        if (!this.#engine) throw new ConnectionUnavailableError();

        this.assertFeature(Features.Sessions);

        await this.#engine.attach(session);
    }

    async detach(session: Uuid): Promise<void> {
        if (!this.#engine) throw new ConnectionUnavailableError();

        this.assertFeature(Features.Sessions);

        return this.#engine.detach(session);
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

    async use(what: Nullable<NamespaceDatabase>, session: Session): Promise<NamespaceDatabase> {
        if (!this.#engine || !this.#state) {
            throw new ConnectionUnavailableError();
        }

        if (what.namespace === null && what.database !== null) {
            throw new MissingNamespaceDatabaseError();
        }

        const res = await this.#engine.use(what, session);

        const namespace = res.namespace ?? what.namespace;
        const database = res.database ?? what.database;
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
        return selected;
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

    importSql(data: string | Blob | ReadableStream): Promise<void> {
        const engine = this.#engine;
        if (!engine) throw new ConnectionUnavailableError();
        if (data instanceof ReadableStream || data instanceof Blob) {
            this.assertFeature(Features.ExportImportRaw);
        }
        return this.#whenAuthenticated(undefined, () => engine.importSql(data));
    }

    exportSql(options: Partial<SqlExportOptions>): Promise<Response | string> {
        const engine = this.#engine;
        if (!engine) throw new ConnectionUnavailableError();
        return this.#whenAuthenticated(undefined, () => engine.exportSql(options));
    }

    exportMlModel(options: MlExportOptions): Promise<Response | Uint8Array> {
        const engine = this.#engine;
        if (!engine) throw new ConnectionUnavailableError();
        return this.#whenAuthenticated(undefined, () => engine.exportMlModel(options));
    }

    query<T>(query: BoundQuery, session: Session, txn?: Uuid): AsyncIterable<QueryChunk<T>> {
        const engine = this.#engine;
        if (!engine) throw new ConnectionUnavailableError();

        if (!this.#needsPreparation()) {
            return engine.query(query, session, txn);
        }

        const prepare = () => this.#prepare(session);

        return {
            async *[Symbol.asyncIterator]() {
                await prepare();
                yield* engine.query<T>(query, session, txn);
            },
        };
    }

    /**
     * Run a query as a different identity than the one of the session, for this query only.
     *
     * A call made as someone else must never silently run as the session. It is refused unless
     * the engine declares that it presents credentials with every request, and implements the
     * method which does so, which an engine, or something wrapping one, may not.
     */
    queryAs<T>(
        query: BoundQuery,
        session: Session,
        txn: Uuid | undefined,
        credential: AuthOrToken,
    ): AsyncIterable<QueryChunk<T>> {
        const engine = this.#engine;
        if (!engine) throw new ConnectionUnavailableError();

        this.assertFeature(Features.PerRequestAuth);
        assertCredential(credential);

        if (typeof engine.queryAs !== "function") {
            throw new UnsupportedFeatureError(Features.PerRequestAuth);
        }

        return engine.queryAs<T>(query, session, txn, credential);
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
                // Ensure the session exists on the server
                if (session.id) await this.attach(session.id);
                await this.#restoreSession(session);
            }

            // Signal engine that sessions are restored and pending calls can be sent
            this.#engine?.ready();

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

        this.#requestAuth?.clear();
        this.#requestAuth = undefined;
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

        const computed = await invokeProvider(provider, session);

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

    // =========================================================== //
    //                                                             //
    //                  Authentication Per Request                 //
    //                                                             //
    // =========================================================== //

    /**
     * Whether requests wait for credentials to be applied to their session. This is for
     * engines which hold credentials in a server side session: when the credentials change,
     * the session is authenticated again before the request is sent.
     */
    #needsPreparation(): boolean {
        return !!this.#requestAuth && !this.#engine?.features.has(Features.PerRequestAuth);
    }

    #whenAuthenticated<T>(session: Session, run: () => Promise<T>): Promise<T> {
        if (!this.#needsPreparation()) return run();

        return this.#prepare(session).then(run);
    }

    /**
     * Make sure the session holds a current credential before a request is sent on it.
     */
    async #prepare(session: Session): Promise<void> {
        const requestAuth = this.#requestAuth;
        const resolver = this.#requestResolver;

        if (!requestAuth || !resolver) return;

        // The user took over authentication of this session
        if (this.getSession(session).authOverriden) return;

        await requestAuth.get(session, async () => {
            const provided = await invokeProvider(resolver, session);
            const sessionState = this.getSession(session);

            if (provided === null) {
                if (sessionState.accessToken) await this.invalidate(session);
                return undefined;
            }

            if (typeof provided === "string") {
                // Nothing to tell the server when the session already presents this very token
                if (provided !== sessionState.accessToken) {
                    await this.authenticate(provided, session, true);
                }

                return provided;
            }

            return (await this.signin(provided, session, true)).access;
        });
    }

    /**
     * Resolve the token a request on a session presents, for engines which present
     * credentials with every request. Nothing is applied to the session and no timers are
     * started, so a request which is the only thing alive does not keep the process running.
     */
    async #requestToken(session: Session, rejected?: string): Promise<string | undefined> {
        const requestAuth = this.#requestAuth;
        const resolver = this.#requestResolver;
        const engine = this.#engine;

        if (!requestAuth || !resolver || !engine) {
            throw new ConnectionUnavailableError();
        }

        // The user took over authentication of this session
        const sessionState = this.getSession(session);

        if (sessionState.authOverriden) return sessionState.accessToken;

        return requestAuth.get(
            session,
            async () => {
                const provided = await invokeProvider(resolver, session);

                if (provided === null) return undefined;
                if (typeof provided === "string") return provided;

                // Over HTTP this exchanges the details for a token, and nothing else
                return (await engine.signin(provided, session)).access;
            },
            rejected,
        );
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

        // Credentials resolved per request are renewed by the requests which need them
        if (this.#requestAuth && !sessionState.authOverriden) return;

        // Schedule token renewal
        const payload = fastParseJwt(tokens.access);

        if (!payload || !payload.exp) return;

        const now = Math.floor(Date.now() / 1000);
        const remaining = Math.max(payload.exp - now, 0);
        const delay = renewalDelay(remaining, this.#expiryMargin);

        sessionState.authRenewal = setTimeout(() => {
            this.#applyAuthentication(session).catch((err) => {
                this.#eventPublisher.publish(
                    "error",
                    err instanceof AuthenticationError ? err : new AuthenticationError(err),
                );

                this.#invalidateOnceExpired(session);
            });
        }, delay * 1000);
    }

    /**
     * A renewal failed, which would otherwise leave the session holding a token which is
     * about to expire, with nothing scheduled to ever replace it. Invalidate the session once
     * that token has expired instead, so that it does not linger on in an unknown state.
     */
    #invalidateOnceExpired(session: Session): void {
        if (!this.#state || !this.hasSession(session)) return;

        const sessionState = this.getSession(session);
        const expiry = sessionState.accessToken ? tokenExpiry(sessionState.accessToken) : undefined;
        const remaining = Math.max((expiry ?? 0) - Math.floor(Date.now() / 1000), 0);

        this.#cancelAuthRenewal(session);

        sessionState.authRenewal = setTimeout(() => {
            this.#abortAuthentication(session).catch((err) => {
                this.#eventPublisher.publish("error", new AuthenticationError(err));
            });
        }, remaining * 1000);
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

        // Credentials resolved per request are applied when a request needs them. Whatever the
        // session held belongs to a connection or session which no longer exists.
        if (this.#requestAuth && !sessionState.authOverriden) {
            this.#requestAuth.forget(session);

            if (sessionState.accessToken) this.#handleAuthInvalidate(session);

            return;
        }

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
                const remaining = Math.max(payload.exp - now, 0);

                if (remaining > renewalDelay(remaining, this.#expiryMargin)) {
                    try {
                        await this.authenticate(sessionState.accessToken, session, true);
                        return;
                    } catch (err) {
                        if (!(err instanceof ServerError)) throw err;
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
                } catch (err) {
                    if (!(err instanceof ServerError)) throw err;
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

        this.#requestAuth?.forget(session);
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
        await this.attach(sessionId);

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

        await this.detach(session);

        this.#requestAuth?.forget(session);
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

    // Expects the session to already be attached on the server
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
