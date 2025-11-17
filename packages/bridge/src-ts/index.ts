import {
    type AccessRecordAuth,
    type AnyAuth,
    type BoundQuery,
    buildRpcAuth,
    ChannelIterator,
    type ConnectionState,
    chunkedRpcResponse,
    type DriverContext,
    type EngineEvents,
    Features,
    getSessionFromState,
    type LiveMessage,
    type MlExportOptions,
    type NamespaceDatabase,
    type Nullable,
    Publisher,
    type QueryChunk,
    type RpcQueryResult,
    type Session,
    type SqlExportOptions,
    type SurrealEngine,
    type Token,
    type Tokens,
    UnexpectedConnectionError,
    Uuid,
    type VersionInfo,
} from "surrealdb";
import type { ConnectionOptions, LiveChannels, LivePayload, SurrealBridge, SurrealBridgeConstructor } from "./types";

export * from "./types";

export class SurrealBridgedEngine<T extends SurrealBridge = SurrealBridge> implements SurrealEngine {
    features = new Set([Features.LiveQueries, Features.Transactions, Features.Sessions]);

    #bridge: T | undefined;
    #bridge_constructor: SurrealBridgeConstructor<T>;
    #context: DriverContext;
    #state: ConnectionState | undefined;
    #active = false;
    #abort: AbortController | undefined;
    #options: ConnectionOptions | undefined;

    #publisher = new Publisher<EngineEvents>();
    #subscriptions = new Publisher<LiveChannels>();

    constructor(bridge_constructor: SurrealBridgeConstructor<T>, context: DriverContext, options?: ConnectionOptions) {
        this.#bridge_constructor = bridge_constructor;
        this.#context = context;
        this.#options = options;
    }

    open(state: ConnectionState): void {
        this.#abort?.abort();
        this.#abort = new AbortController();
        this.#active = true;
        this.#state = state;
        this.#initialize(state, this.#abort.signal);
    }

    async close(): Promise<void> {
        this.#state = undefined;
        this.#abort?.abort();
        this.#abort = undefined;
        this.#active = false;
        this.#bridge?.free();
        this.#bridge = undefined;
        this.#publisher.publish("disconnected");
    }

    async [Symbol.asyncDispose](): Promise<void> {
        await this.close();
    }

    subscribe<K extends keyof EngineEvents>(
        event: K,
        listener: (...payload: EngineEvents[K]) => void,
    ): () => void {
        return this.#publisher.subscribe(event, listener);
    }

    async #initialize(state: ConnectionState, signal: AbortSignal) {
        try {
            this.#bridge = await this.#bridge_constructor.connect(state.url.toString(), this.#options);

            const reader = this.#bridge.notifications().getReader();

            if (signal.aborted) {
                return;
            }

            (async () => {
                while (this.#active) {
                    const { done, value } = await reader.read();

                    if (done) {
                        break;
                    }

                    const payload = this.#context.codecs.cbor.decode<LivePayload>(value);

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

    private get bridge(): SurrealBridge {
        if (!this.#bridge) throw new Error("Connection not active");
        return this.#bridge;
    }

    private get state(): ConnectionState {
        if (!this.#state) throw new Error("Connection not active");
        return this.#state;
    }

    async health(): Promise<void> {}
    async version(): Promise<VersionInfo> {
        return {
            version: this.bridge.version(),
        };
    }

    async sessions(): Promise<Uuid[]> {
        return this.bridge.sessions().map((x) => new Uuid(x));
    }

    async use(what: Nullable<NamespaceDatabase>, session: Session): Promise<void> {
        await this.bridge.yuse(send_opt_uuid(session), what);
    }

    async signup(auth: AccessRecordAuth, session: Session): Promise<Tokens> {
        const sessionState = getSessionFromState(this.state, session);
        const cbor = this.#context.codecs.cbor.encode(buildRpcAuth(sessionState, auth));
        const raw = await this.bridge.signup(send_opt_uuid(session), cbor);
        return this.#context.codecs.cbor.decode(raw);
    }

    async signin(auth: AnyAuth, session: Session): Promise<Tokens> {
        const sessionState = getSessionFromState(this.state, session);
        const cbor = this.#context.codecs.cbor.encode(buildRpcAuth(sessionState, auth));
        const raw = await this.bridge.signin(send_opt_uuid(session), cbor);
        return this.#context.codecs.cbor.decode(raw);
    }

    async authenticate(token: Token, session: Session): Promise<void> {
        await this.bridge.authenticate(send_opt_uuid(session), token);
    }

    async set(name: string, value: unknown, session: Session): Promise<void> {
        const cbor = this.#context.codecs.cbor.encode(value);
        await this.bridge.set(send_opt_uuid(session), name, cbor);
    }

    async unset(name: string, session: Session): Promise<void> {
        await this.bridge.unset(send_opt_uuid(session), name);
    }

    async refresh(tokens: Tokens, session: Session): Promise<Tokens> {
        const cbor = this.#context.codecs.cbor.encode(tokens);
        const raw = await this.bridge.refresh(send_opt_uuid(session), cbor);
        return this.#context.codecs.cbor.decode(raw);
    }

    async revoke(tokens: Tokens): Promise<void> {
        const cbor = this.#context.codecs.cbor.encode(tokens);
        await this.bridge.revoke(cbor);
    }

    async invalidate(session: Session): Promise<void> {
        await this.bridge.invalidate(send_opt_uuid(session));
    }

    async reset(session: Session): Promise<void> {
        await this.bridge.reset(send_opt_uuid(session));
    }

    async begin(_: Session): Promise<Uuid> {
        return new Uuid(await this.bridge.begin());
    }

    async commit(txn: Uuid, _: Session): Promise<void> {
        await this.bridge.commit(txn.toUint8Array());
    }

    async cancel(txn: Uuid, _: Session): Promise<void> {
        await this.bridge.cancel(txn.toUint8Array());
    }

    async importSql(data: string): Promise<void> {
        await this.bridge.import(undefined, data);
    }

    async exportSql(options: Partial<SqlExportOptions>): Promise<string> {
        const cbor = this.#context.codecs.cbor.encode(options ?? {});
        return this.bridge.export(undefined, cbor);
    }

    async exportMlModel(_: MlExportOptions): Promise<Uint8Array> {
        throw new Error("Not implemented");
    }

    async *query<T>(query: BoundQuery, session: Session, txn?: Uuid): AsyncIterable<QueryChunk<T>> {
        const cbor = this.#context.codecs.cbor.encode(query.bindings);
        const raw = await this.bridge.query(
            send_opt_uuid(session),
            send_opt_uuid(txn),
            query.query,
            cbor,
        );

        const responses: RpcQueryResult[] = this.#context.codecs.cbor.decode(raw);
        for await (const chunk of chunkedRpcResponse<T>(responses)) {
            yield chunk;
        }
    }

    liveQuery(id: Uuid): AsyncIterable<LiveMessage> {
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
}

function send_opt_uuid(session: Uuid | undefined): undefined | Uint8Array {
    return session?.toUint8Array();
}
