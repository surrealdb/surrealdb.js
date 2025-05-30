import type {
	AnyAuth,
	AuthProvider,
	AuthResponse,
	ConnectOptions,
	ConnectionState,
	ConnectionStatus,
	DriverContext,
	EngineImpl,
	EventPublisher,
	ExportOptions,
	LiveHandler,
	LiveMessage,
	LivePayload,
	RpcRequest,
	RpcResponse,
	SurrealEngine,
	Token,
} from "../types";

import {
	AuthenticationFailed,
	ConnectionUnavailable,
	SurrealError,
	UnsupportedEngine,
	VersionCheckFailure,
} from "../errors";

import { HttpEngine, WebSocketEngine } from "../engine";
import { ReconnectContext } from "../internal/reconnect";
import { fastParseJwt } from "../internal/tokens";
import { versionCheck } from "../utils";
import { Publisher } from "../utils/publisher";
import type { Uuid } from "../value";

const DEFAULT_ENGINES: Record<string, EngineImpl> = {
	ws: WebSocketEngine,
	wss: WebSocketEngine,
	http: HttpEngine,
	https: HttpEngine,
};

type ConnectionEvents = {
	connecting: [];
	connected: [];
	disconnected: [];
	reconnecting: [];
	error: [Error];
	authenticated: [Token];
	invalidated: [];
};

type LiveChannels = Record<string, LivePayload>;
type ConvertedAuth = Record<string, unknown> | Token;

export class ConnectionController implements EventPublisher<ConnectionEvents> {
	#eventPublisher = new Publisher<ConnectionEvents>();
	#livePublisher = new Publisher<LiveChannels>();
	#context: DriverContext;
	#state: ConnectionState | undefined;
	#engine: SurrealEngine | undefined;
	#status: ConnectionStatus = "disconnected";
	#authProvider: AuthProvider | undefined;
	#authRenewal: ReturnType<typeof setTimeout> | undefined;
	#authCache: ConvertedAuth | undefined;
	#checkVersion = true;
	#renewAccess = true;

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
		if (this.#engine) {
			await this.#engine.close();
		}

		const engineMap = { ...DEFAULT_ENGINES, ...this.#context.options.engines };
		const protocol = url.protocol.slice(0, -1);
		const Engine = engineMap[protocol];

		if (!Engine) {
			throw new UnsupportedEngine(protocol);
		}

		this.#engine = new Engine(this.#context);
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

		this.#engine.subscribe("connecting", () => this.onConnecting());
		this.#engine.subscribe("connected", () => this.onConnected());
		this.#engine.subscribe("disconnected", () => this.onDisconnected());
		this.#engine.subscribe("reconnecting", () => this.onReconnecting());
		this.#engine.subscribe("live", (msg) => this.onLiveMessage(msg));

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

	public async rpc<
		Method extends string,
		Params extends unknown[] | undefined,
		Result,
	>(
		request: RpcRequest<Method, Params>,
		skipAuthCache?: boolean,
	): Promise<RpcResponse<Result>> {
		if (!this.#state || !this.#engine) {
			throw new ConnectionUnavailable();
		}

		// Synchronize with local state
		switch (request.method) {
			case "use": {
				const [ns, db] = request.params as [
					string | null | undefined,
					string | null | undefined,
				];

				if (ns === null) this.#state.namespace = undefined;
				if (db === null) this.#state.database = undefined;
				if (ns) this.#state.namespace = ns;
				if (db) this.#state.database = db;
				break;
			}
			case "let": {
				const [key, value] = request.params as [string, unknown];
				this.#state.variables[key] = value;
				break;
			}
			case "unset": {
				const [key] = request.params as [string];
				delete this.#state.variables[key];
				break;
			}
		}

		// Send the request to the underlying engine
		const response: RpcResponse<Result> = await this.#engine.send(request);

		// Update authentication state
		if ("result" in response) {
			switch (request.method) {
				case "signin":
				case "signup": {
					const result = response.result as string | AuthResponse;

					if (typeof result === "string") {
						this.#state.accessToken = result;
					} else {
						this.#state.accessToken = result.token;
						this.#state.refreshToken = result.refresh;
					}

					if (!skipAuthCache) {
						this.#authCache = request.params?.[0] as ConvertedAuth;
					}

					this.handleAuthUpdate();
					break;
				}
				case "authenticate": {
					const [token] = request.params as [string];
					this.#state.accessToken = token;

					if (!skipAuthCache) {
						this.#authCache = request.params?.[0] as Token;
					}

					this.handleAuthUpdate();
					break;
				}
				case "invalidate": {
					this.handleAuthInvalidate();
					break;
				}
				case "reset": {
					this.#state.namespace = undefined;
					this.#state.database = undefined;
					this.#state.variables = {};
					this.handleAuthInvalidate();
					break;
				}
			}
		}

		return response;
	}

	public get state(): ConnectionState | undefined {
		return this.#state;
	}

	public get status(): ConnectionStatus {
		return this.#status;
	}

	public liveSubscribe(id: Uuid, handler: LiveHandler): () => void {
		return this.#livePublisher.subscribe(id.toString(), (...payload) =>
			handler(...payload),
		);
	}

	public async ready(): Promise<void> {
		if (this.#status === "disconnected") {
			throw new ConnectionUnavailable();
		}

		if (this.#status === "connected") {
			return;
		}

		const [error] = await this.#eventPublisher.subscribeFirst(
			"connected",
			"error",
		);

		if (error) {
			throw error;
		}
	}

	public async import(data: string): Promise<void> {
		if (!this.#engine) {
			throw new ConnectionUnavailable();
		}

		return this.#engine.import(data);
	}

	public async export(options?: Partial<ExportOptions>): Promise<string> {
		if (!this.#engine) {
			throw new ConnectionUnavailable();
		}

		return this.#engine.export(options);
	}

	public buildAuth(auth: AnyAuth): Record<string, unknown> {
		if (!this.#state) {
			throw new ConnectionUnavailable();
		}

		// Record user authentication
		if ("variables" in auth) {
			const namespace = auth.namespace ?? this.#state.namespace;
			const database = auth.database ?? this.#state.database;

			if (!database || !namespace) {
				throw new SurrealError(
					"Namespace and database must be provided or selected for record authentication",
				);
			}

			return {
				...auth.variables,
				ac: auth.access,
				ns: namespace,
				db: database,
			};
		}

		// System authentication
		const access = "access" in auth ? auth.access : undefined;
		const namespace = "namespace" in auth ? auth.namespace : undefined;
		const database = "database" in auth ? auth.database : undefined;
		const result: Record<string, unknown> = {
			user: auth.username,
			pass: auth.password,
		};

		if (database && !namespace) {
			throw new SurrealError(
				"Database authentication requires a namespace to be provided",
			);
		}

		if (access) result.ac = access;
		if (namespace) result.ns = namespace;
		if (database) result.db = database;

		return result;
	}

	private onConnecting(): void {
		this.#status = "connecting";
		this.#eventPublisher.publish("connecting");
	}

	private async onConnected(): Promise<void> {
		// Perform version check
		if (this.#checkVersion) {
			try {
				const version: RpcResponse<string> = await this.rpc({
					method: "version",
				});

				if (version.result) {
					versionCheck(version.result);
				} else {
					throw new VersionCheckFailure(undefined, version.error);
				}
			} catch (err: unknown) {
				this.#eventPublisher.publish("error", err as Error);
				return;
			}
		}

		// Apply selected namespace and database
		if (this.#state?.namespace || this.#state?.database) {
			await this.rpc({
				method: "use",
				params: [this.#state.namespace, this.#state.database],
			});
		}

		// Apply authentication details
		await this.internalAuth();

		this.#status = "connected";
		this.#eventPublisher.publish("connected");
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

	private onLiveMessage(msg: LiveMessage): void {
		if (msg.action === "KILLED") {
			this.#livePublisher.publish(msg.id.toString(), "CLOSED", "KILLED");
		} else {
			this.#livePublisher.publish(
				msg.id.toString(),
				msg.action,
				msg.result,
				msg.record,
			);
		}
	}

	private async computeAuth(): Promise<ConvertedAuth | null> {
		if (this.#authCache) {
			return this.#authCache;
		}

		const provider = this.#authProvider;

		if (!provider) {
			return null;
		}

		const auth = typeof provider === "function" ? await provider() : provider;

		if (typeof auth === "string") {
			return auth;
		}

		return this.buildAuth(auth);
	}

	private async internalAuth(): Promise<void> {
		try {
			const auth = await this.computeAuth();

			if (auth === null) {
				return;
			}

			const request: RpcRequest =
				typeof auth === "string"
					? { method: "authenticate", params: [auth] }
					: { method: "signin", params: [auth] };

			await this.rpc(request, true);
		} catch (err: unknown) {
			this.#eventPublisher.publish("error", new AuthenticationFailed(err));
		}
	}

	private handleAuthUpdate(): void {
		if (!this.#state || !this.#state.accessToken) return;

		this.cancelAuthRenewal();
		this.#eventPublisher.publish("authenticated", this.#state.accessToken);

		const renew = this.#renewAccess;
		const token = this.#state.accessToken;
		const payload = fastParseJwt(token);

		// Check expirey existance
		if (!payload || !payload.exp) return;

		// Renew 60 seconds before expiry
		const now = Math.floor(Date.now() / 1000);
		const delay = Math.max(payload.exp - now - 60) * 1000;

		if (delay <= 0) return;

		// Schedule next renewal or invalidation
		this.#authRenewal = setTimeout(() => {
			if (renew) {
				this.internalAuth();
			} else {
				this.handleAuthInvalidate();
			}
		}, delay);
	}

	private handleAuthInvalidate(): void {
		if (!this.#state) return;
		this.#state.accessToken = undefined;
		this.#state.refreshToken = undefined;
		this.#authCache = undefined;
		this.cancelAuthRenewal();
		this.#eventPublisher.publish("invalidated");
	}

	private cancelAuthRenewal(): void {
		if (this.#authRenewal === undefined) return;
		clearTimeout(this.#authRenewal);
		this.#authRenewal = undefined;
	}
}
