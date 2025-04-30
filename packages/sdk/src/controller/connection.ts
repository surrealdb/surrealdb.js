import type {
	ConnectionState,
	ConnectionStatus,
	ConnectOptions,
	DriverContext,
	EngineImpl,
	SurrealEngine,
} from "../types/surreal";

import { HttpEngine, WebSocketEngine } from "../engine";
import { UnsupportedEngine } from "../errors";
import { ReconnectContext } from "../internal/reconnect";

const DEFAULT_ENGINES: Record<string, EngineImpl> = {
	ws: WebSocketEngine,
	wss: WebSocketEngine,
	http: HttpEngine,
	https: HttpEngine,
};

export class ConnectionController {
	#context: DriverContext;
	#state: ConnectionState | undefined;
	#engine: SurrealEngine | undefined;
	#status: ConnectionStatus = "disconnected";

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
		this.#state = {
			url,
			namespace: undefined,
			database: undefined,
			token: undefined,
			reconnect: new ReconnectContext(options.reconnect),
		};

		this.#engine.subscribe("connected", () => this.onConnected());
		this.#engine.subscribe("disconnected", () => this.onConnected());

		await this.#engine.open(this.#state);

		return true;
	}

	public async disconnect(): Promise<true> {
		if (this.#engine) {
			await this.#engine.close();
		}

		return true;
	}

	public get status(): ConnectionStatus {
		return this.#status;
	}

	public get connected(): boolean {
		return this.status === "connected";
	}

	private onConnected(): void {
		this.#isConnected = true;
		// TODO Apply state (auth + namespace + database)
	}

	private onDisconnected(): void {
		this.#isConnected = false;
	}
}
