import {
    ChannelIterator,
    type ConnectionState,
    ConnectionUnavailableError,
    type DriverContext,
    type EngineEvents,
    Features,
    type LiveAction,
    type LiveMessage,
    Publisher,
    type RecordId,
    RpcEngine,
    type RpcRequest,
    type SqlExportOptions,
    type SurrealEngine,
    UnexpectedConnectionError,
    type Uuid,
} from "surrealdb";
import type { ConnectionOptions } from "../wasm/surrealdb";
import type { EngineBroker } from "./common";

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
    #broker: EngineBroker;
    #publisher = new Publisher<EngineEvents>();
    #subscriptions = new Publisher<LiveChannels>();
    #abort: AbortController | undefined;
    #options: ConnectionOptions | undefined;

    constructor(broker: EngineBroker, context: DriverContext, options?: ConnectionOptions) {
        super(context);
        this.#broker = broker;
        this.#options = options;
    }

    features = new Set([Features.LiveQueries]);

    open(state: ConnectionState): void {
        this.#abort?.abort();
        this.#abort = new AbortController();
        this._state = state;
        this.#initialize(state, this.#abort.signal);
    }

    async close(): Promise<void> {
        this._state = undefined;
        this.#abort?.abort();
        this.#abort = undefined;
        await this.#broker.close();
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
        if (!this.#broker.isConnected) {
            throw new ConnectionUnavailableError();
        }

        const id = this._context.uniqueId();
        const payload = this._context.codecs.cbor.encode({ id, ...request });

        const response = await this.#broker.execute(payload);
        return this._context.codecs.cbor.decode<Result>(response);
    }

    override async importSql(data: string): Promise<void> {
        return this.#broker.importSql(data);
    }

    override async exportSql(options: Partial<SqlExportOptions>): Promise<string> {
        const payload = new Uint8Array(this._context.codecs.cbor.encode(options));
        return this.#broker.exportSql(payload);
    }

    async #initialize(state: ConnectionState, signal: AbortSignal) {
        try {
            await this.#broker.connect(state.url.toString(), this.#options, (data) => {
                const payload = this._context.codecs.cbor.decode<LivePayload>(data);

                if (payload.id) {
                    this.#subscriptions.publish(payload.id.toString(), {
                        queryId: payload.id,
                        action: payload.action,
                        recordId: payload.record,
                        value: payload.result,
                    });
                }
            });

            if (signal.aborted) {
                return;
            }

            this.#publisher.publish("connected");
        } catch (err) {
            this.#publisher.publish("error", new UnexpectedConnectionError(err));
        }
    }
}
