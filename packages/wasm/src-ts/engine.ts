import {
    type ConnectionState,
    ConnectionUnavailable,
    type DriverContext,
    type EngineEvents,
    JsonEngine,
    type LiveMessage,
    Publisher,
    type RpcRequest,
    type SurrealEngine,
    UnexpectedConnectionError,
    type Uuid,
} from "surrealdb";
import { getIncrementalID } from "../../sdk/src/internal/get-incremental-id";
import { type ConnectionOptions, SurrealWasmEngine } from "../wasm/surrealdb";

export class WebAssemblyEngine extends JsonEngine implements SurrealEngine {
    #engine: SurrealWasmEngine | undefined;
    #publisher = new Publisher<EngineEvents>();
    #active = false;
    #options: ConnectionOptions | undefined;

    constructor(context: DriverContext, options?: ConnectionOptions) {
        super(context);
        this.#options = options;
    }

    open(state: ConnectionState): void {
        this.#publisher.publish("connecting");
        this.#active = true;
        this._state = state;
        this.#initialize(state);
    }

    async close(): Promise<void> {
        this._state = undefined;
        this.#active = false;
        this.#engine?.free();
        this.#engine = undefined;
        this.#publisher.publish("disconnected");
    }

    subscribe<K extends keyof EngineEvents>(
        event: K,
        listener: (...payload: EngineEvents[K]) => void,
    ): () => void {
        return this.#publisher.subscribe(event, listener);
    }

    // TODO Implement live queries
    override liveQuery(_id: Uuid): AsyncIterable<LiveMessage> {
        throw new Error("Method not implemented.");
    }

    override async send<Method extends string, Params extends unknown[] | undefined, Result>(
        request: RpcRequest<Method, Params>,
    ): Promise<Result> {
        if (!this.#active || !this.#engine) {
            throw new ConnectionUnavailable();
        }

        const id = getIncrementalID();
        const payload = this._context.encode({ id, ...request });

        const response = await this.#engine.execute(payload);
        const result = this._context.decode<Result>(response);

        return result;
    }

    async #initialize(state: ConnectionState) {
        try {
            this.#engine = await SurrealWasmEngine.connect(state.url.toString(), this.#options);
            this.#publisher.publish("connected");
        } catch (err) {
            this.#publisher.publish("error", new UnexpectedConnectionError(err));
        }
    }
}
