import { UnsupportedEngine } from "../errors";
import { ReconnectContext } from "../internal/reconnect";
import type {
	ConnectionState,
	ConnectOptions,
	DriverContext,
	SurrealEngine,
} from "../types/surreal";

export class SurrealController {
	#context: DriverContext;
	#state: ConnectionState | undefined;
	#engine: SurrealEngine | undefined;
	#isConnected = false;

	constructor(context: DriverContext) {
		this.#context = context;
	}

	public async connect(url: URL, options: ConnectOptions): Promise<void> {
		if (this.#engine) {
			await this.#engine.close();
		}

		const engineMap = this.#context.options.engines ?? {};
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

		return this.#engine.open(this.#state);
	}

	public disconnect(): Promise<void> {
		if (this.#engine) {
			return this.#engine.close();
		}

		return Promise.resolve();
	}

	private onConnected(): void {
		this.#isConnected = true;
		// TODO Apply state (auth + namespace + database)
	}

	public get connected(): boolean {
		return this.#isConnected;
	}

	private onDisconnected(): void {
		this.#isConnected = false;
	}
}
