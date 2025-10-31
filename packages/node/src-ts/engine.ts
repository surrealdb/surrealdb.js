import {
    ChannelIterator,
    type ConnectionState,
    ConnectionUnavailableError,
    type DriverContext,
    type EngineEvents,
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
import { LIVE_QUERIES_FEATURE } from "../../sdk/src/utils/features";
import { type ConnectionOptions, type NotificationReceiver, SurrealNodeEngine } from "../napi";

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
export class NodeEngine extends RpcEngine implements SurrealEngine {
    #engine: SurrealNodeEngine | undefined;
    #notificationReceiver: NotificationReceiver | undefined;
    #publisher = new Publisher<EngineEvents>();
    #subscriptions = new Publisher<LiveChannels>();
    #active = false;
    #abort: AbortController | undefined;
    #options: ConnectionOptions | undefined;

    constructor(context: DriverContext, options?: ConnectionOptions) {
        super(context);
        this.#options = options;
    }

    features = new Set([LIVE_QUERIES_FEATURE]);

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
        this.#notificationReceiver = undefined;
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
            throw new ConnectionUnavailableError();
        }

        const id = this._context.uniqueId();
        const payload = this._context.codecs.cbor.encode({ id, ...request });

        const response = await this.#engine.execute(payload);
        const result = this._context.codecs.cbor.decode<Result>(response);

        return result;
    }

    async #initialize(state: ConnectionState, signal: AbortSignal) {
        try {
            this.#engine = await SurrealNodeEngine.connect(state.url.toString(), this.#options);

            if (signal.aborted) {
                return;
            }

            this.#notificationReceiver = await this.#engine.notifications();

            (async () => {
                while (this.#active && this.#notificationReceiver) {
                    const value = await this.#notificationReceiver.recv();

                    if (value === null) {
                        break; // Channel closed
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
