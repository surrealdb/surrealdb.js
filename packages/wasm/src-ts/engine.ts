import {
    type ConnectionState,
    type DriverContext,
    type EngineEvents,
    JsonEngine,
    type LiveAction,
    type LiveMessage,
    Publisher,
    type RecordId,
    type RpcRequest,
    type SurrealEngine,
    UnexpectedConnectionError,
    type Uuid,
} from "surrealdb";

import { type ConnectionOptions, SurrealWasmEngine } from "../wasm/surrealdb";

type LiveChannels = Record<string, [LiveMessage]>;

interface LivePayload {
    id: Uuid;
    action: LiveAction;
    result: LiveMessage;
    record: RecordId;
}

export class WebAssemblyEngine extends JsonEngine implements SurrealEngine {
    #engine: SurrealWasmEngine | undefined;
    #publisher = new Publisher<EngineEvents>();
    #reader?: Promise<void>;
    #subscriptions = new Publisher<LiveChannels>();
    #active = false;
    #terminated = false;
    #options: ConnectionOptions | undefined;

    constructor(context: DriverContext, options?: ConnectionOptions) {
        super(context);
        this.#options = options;
    }

    open(state: ConnectionState): void {
        this.#publisher.publish("connecting");
        this.#terminated = false;
        this._state = state;
        this.#initialize(state);
    }

    close(): Promise<void> {
        throw new Error("Method not implemented.");
    }

    subscribe<K extends keyof EngineEvents>(
        _event: K,
        _listener: (...payload: EngineEvents[K]) => void,
    ): () => void {
        throw new Error("Method not implemented.");
    }

    override liveQuery(_id: Uuid): AsyncIterable<LiveMessage> {
        throw new Error("Method not implemented.");
    }

    override send<Method extends string, Params extends unknown[] | undefined, Result>(
        _request: RpcRequest<Method, Params>,
    ): Promise<Result> {
        throw new Error("Method not implemented.");
    }

    async #initialize(state: ConnectionState) {
        try {
            const engine = await SurrealWasmEngine.connect(state.url.toString(), this.#options);

            this.#engine = engine;
            this.#reader = (async () => {
                // const reader = engine.notifications().getReader();
                // while (this.#active) {
                //     const { done, value } = await reader.read();
                //     if (done) break;
                //     const raw = value as Uint8Array;
                //     const { id, action, result } = this._context.decode(raw.buffer);
                //     if (id) this.emitter.emit(`live-${id.toString()}`, [action, result], true);
                // }
            })();

            this.#publisher.publish("connected");
        } catch (err) {
            this.#publisher.publish("error", new UnexpectedConnectionError(err));
        }
    }
}
