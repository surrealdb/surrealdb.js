import type {
	ConnectionState,
	ConnectionStatus,
	ConnectOptions,
	DriverContext,
	EngineImpl,
	SurrealEngine,
	EventPublisher,
	RpcRequest,
	RpcResponse,
	Subscribe,
	AuthResponse,
	AuthProvider,
} from "../types";

import {
	ConnectionUnavailable,
	UnsupportedEngine,
	VersionCheckFailure,
} from "../errors";

import { HttpEngine, WebSocketEngine } from "../engine";
import { ReconnectContext } from "../internal/reconnect";
import { Publisher, subscribeFirst } from "../internal/publisher";
import { versionCheck } from "../utils";

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

export class ConnectionController implements EventPublisher<ConnectionEvents> {
	#publisher = new Publisher<ConnectionEvents>();
	#context: DriverContext;
	#state: ConnectionState | undefined;
	#engine: SurrealEngine | undefined;
	#status: ConnectionStatus = "disconnected";
	#authProvider: AuthProvider | undefined;
	#liveQueries = new Map<string, unknown>();
	#checkVersion = true;

	subscribe: Subscribe<ConnectionEvents> = this.#publisher.subscribe;

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

		this.#engine.open(this.#state);

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

	public async awaitConnectedOrError(): Promise<void> {
		if (this.#status === "connected") {
			return;
		}

		await subscribeFirst(
			this as EventPublisher<ConnectionEvents>,
			"connected",
			"error",
		);
	}

	private onConnecting(): void {
		this.#status = "connecting";
		this.#publisher.publish("connecting");
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
				this.#publisher.publish("error", err as Error);
				return;
			}
		}

		// Apply selected namespace and database
		if (this.#state?.namespace || this.#state?.database) {
			this.rpc({
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
				this.rpc({
					method: "authenticate",
					params: [auth],
				});
			} else {
				this.rpc({
					method: "signin",
					params: [auth],
				});
			}
		}

		this.#status = "connected";
		this.#publisher.publish("connected");
	}

	private onDisconnected(): void {
		this.#state = undefined;
		this.#engine = undefined;
		this.#status = "disconnected";
		this.#publisher.publish("disconnected");
	}

	private onReconnecting(): void {
		this.#status = "reconnecting";
		this.#publisher.publish("reconnecting");
	}
}
