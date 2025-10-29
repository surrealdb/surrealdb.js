import {
    ChannelIterator,
    type ConnectionState,
    ConnectionUnavailable,
    type DriverContext,
    type EngineEvents,
    type Feature,
    type LiveAction,
    type LiveMessage,
    Publisher,
    type RecordId,
    RpcEngine,
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

/**
 * The engine implementation responsible for communicating with an embedded
 * WebAssembly build of SurrealDB.
 */
export class WebAssemblyEngine extends RpcEngine implements SurrealEngine {
    #engine: SurrealWasmEngine | undefined;
    #publisher = new Publisher<EngineEvents>();
    #subscriptions = new Publisher<LiveChannels>();
    #active = false;
    #abort: AbortController | undefined;
    #options: ConnectionOptions | undefined;

    constructor(context: DriverContext, options?: ConnectionOptions) {
        super(context);
        this.#options = options;
    }

    features = new Set<Feature>(["live-queries"]);

    open(state: ConnectionState): void {
        this.#abort?.abort();
        this.#abort = new AbortController();
        this.#active = true;
        this._state = state;
        this.#initialize(state, this.#abort.signal);
    }

    async close(): Promise<void> {
        this._state = undefined;
        this.#abort?.abort();
        this.#abort = undefined;
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

    override liveQuery(id: Uuid): AsyncIterable<LiveMessage> {
        const channel = new ChannelIterator<LiveMessage>(() => {
            unsub1();
            unsub2();
        });

        const unsub1 = this.#subscriptions.subscribe(id.toString(), (msg) => {
            channel.submit(msg);
        });
        const unsub2 = this.#publisher.subscribe("disconnected", () => {
            channel.cancel();
        });

        return channel;
    }

    override async send<Method extends string, Params extends unknown[] | undefined, Result>(
        request: RpcRequest<Method, Params>,
    ): Promise<Result> {
        if (!this.#active || !this.#engine) {
            throw new ConnectionUnavailable();
        }

        const id = this._context.uniqueId();
        const payload = this._context.codecs.cbor.encode({ id, ...request });

        const response = await this.#engine.execute(payload);
        const result = this._context.codecs.cbor.decode<Result>(response);

        return result;
    }

    async #initialize(state: ConnectionState, signal: AbortSignal) {
        try {
            this.#engine = await SurrealWasmEngine.connect(state.url.toString(), this.#options);

            const reader = this.#engine.notifications().getReader();

            if (signal.aborted) {
                return;
            }

            (async () => {
                while (this.#active) {
                    const { done, value } = await reader.read();

                    if (done) {
                        break;
                    }

                    const payload = this._context.codecs.cbor.decode<LivePayload>(value);

                    if (payload.id) {
                        this.#subscriptions.publish(payload.id.toString(), {
                            queryId: payload.id,
                            action: payload.action,
                            recordId: payload.record,
                            value: payload.result,
                        });
                    }
                }
            })();

            this.#publisher.publish("connected");
        } catch (err) {
            this.#publisher.publish("error", new UnexpectedConnectionError(err));
        }
    }
}
