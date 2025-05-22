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
} from "../types";

import {
	ConnectionUnavailable,
	SurrealError,
	UnsupportedEngine,
	VersionCheckFailure,
} from "../errors";

import { HttpEngine, WebSocketEngine } from "../engine";
import { ReconnectContext } from "../internal/reconnect";
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
};

type LiveChannels = Record<string, LivePayload>;

export class ConnectionController implements EventPublisher<ConnectionEvents> {
	#eventPublisher = new Publisher<ConnectionEvents>();
	#livePublisher = new Publisher<LiveChannels>();
	#context: DriverContext;
	#state: ConnectionState | undefined;
	#engine: SurrealEngine | undefined;
	#status: ConnectionStatus = "disconnected";
	#authProvider: AuthProvider | undefined;
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
	>(request: RpcRequest<Method, Params>): Promise<RpcResponse<Result>> {
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
			case "invalidate": {
				this.#state.accessToken = undefined;
				this.#state.refreshToken = undefined;
				break;
			}
			case "reset": {
				this.#state.accessToken = undefined;
				this.#state.refreshToken = undefined;
				this.#state.namespace = undefined;
				this.#state.database = undefined;
				this.#state.variables = {};
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

					break;
				}
				case "authenticate": {
					const [token] = request.params as [string];
					this.#state.accessToken = token;
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
		if (this.#authProvider) {
			const auth =
				typeof this.#authProvider === "function"
					? await this.#authProvider()
					: this.#authProvider;

			if (typeof auth === "string") {
				await this.rpc({
					method: "authenticate",
					params: [auth],
				});
			} else {
				await this.rpc({
					method: "signin",
					params: [this.buildAuth(auth)],
				});
			}
		}

		this.#status = "connected";
		this.#eventPublisher.publish("connected");
	}

	private onDisconnected(): void {
		this.#state = undefined;
		this.#engine = undefined;
		this.#status = "disconnected";
		this.#eventPublisher.publish("disconnected");
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
}
