import type { ConnectionOptions } from "@surrealdb/wasm-native";
import {
    type BoundQuery,
    ChannelIterator,
    type ConnectionState,
    ConnectionUnavailableError,
    type DriverContext,
    type EngineEvents,
    Features,
    framesToChunks,
    type LiveAction,
    LiveDispatcher,
    type LiveMessage,
    Publisher,
    parseRpcError,
    type QueryChunk,
    type QueryStreamFrame,
    type RecordId,
    RpcEngine,
    type RpcRequest,
    type Session,
    type SqlExportOptions,
    type SurrealEngine,
    UnexpectedConnectionError,
    type Uuid,
} from "surrealdb";
import type { EngineBroker } from "./common";
import { wrapSqonError } from "./wrap-sqon-error";

interface LivePayload {
    id: Uuid;
    action: LiveAction;
    result?: Record<string, unknown>;
    record?: RecordId;
}

/**
 * The engine implementation responsible for communicating with an embedded
 * WebAssembly build of SurrealDB.
 */
export class WebAssemblyEngine extends RpcEngine implements SurrealEngine {
    #broker: EngineBroker;
    #publisher = new Publisher<EngineEvents>();
    #live = new LiveDispatcher();
    #abort: AbortController | undefined;
    #options: ConnectionOptions | undefined;

    constructor(broker: EngineBroker, context: DriverContext, options?: ConnectionOptions) {
        super(context);
        this.#broker = broker;
        this.#options = options;
    }

    features = new Set([
        Features.LiveQueries,
        Features.Sessions,
        Features.Transactions,
        Features.Api,
        Features.ExportImportRaw,
    ]);

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
        this.#live.clear();
        this.#publisher.publish("disconnected");
    }

    ready(): void {
        // No-op for WebAssembly engine - no pending calls to resend
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

        const unsub1 = this.#live.subscribe(id.toString(), (msg) => {
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
        const payload = wrapSqonError(() => this._context.codecs.cbor.encode({ id, ...request }));

        const response = await this.#broker.execute(payload);
        const decoded = wrapSqonError(() =>
            this._context.codecs.cbor.decode<Record<string, unknown>>(response),
        );

        if (decoded && typeof decoded === "object" && "error" in decoded) {
            throw parseRpcError(
                decoded.error as {
                    code: number;
                    message: string;
                    kind?: string;
                    details?: Record<string, unknown>;
                },
            );
        }

        return decoded as Result;
    }

    /**
     * Run a query, yielding each batch of rows as the engine produces it.
     *
     * The base implementation awaits the whole answer and then hands it over in
     * one piece, which for an embedded engine means holding an entire `SELECT`
     * in memory before JavaScript sees a single row. The module can stream, so
     * this drives that instead: time-to-first-row becomes the cost of one batch
     * rather than of the whole result.
     *
     * Nothing runs ahead of this loop. Reading a frame is what drives the query
     * inside the module, so a consumer that stops iterating stops the scan, and
     * one that abandons it cancels the query outright.
     */
    override query<T>(
        query: BoundQuery,
        session: Session,
        txn?: Uuid,
    ): AsyncIterable<QueryChunk<T>> {
        return framesToChunks<T>(this.#queryFrames(query, session, txn));
    }

    async *#queryFrames(
        query: BoundQuery,
        session: Session,
        txn?: Uuid,
    ): AsyncIterable<QueryStreamFrame> {
        if (!this.#broker.isConnected) {
            throw new ConnectionUnavailableError();
        }

        const id = this._context.uniqueId();
        const payload = wrapSqonError(() =>
            this._context.codecs.cbor.encode({
                id,
                method: "query_stream",
                params: [query.query, query.bindings],
                session,
                txn,
            }),
        );

        // A failure before execution begins — a denied capability, a parse
        // error, an unknown transaction — rejects here rather than arriving as
        // a frame, because there is no statement to attribute it to.
        const reader = (await this.#broker.queryStream(payload)).getReader();

        try {
            for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                yield wrapSqonError(() =>
                    this._context.codecs.cbor.decode<QueryStreamFrame>(value),
                );
            }
        } finally {
            // Reached on an early `break` as well as on the last frame, and it
            // is what tells the module a consumer that walked away is gone.
            await reader.cancel().catch(() => {});
        }
    }

    override async importSql(data: string | Blob | ReadableStream): Promise<void> {
        // NOTE We currently convert streams into strings as the
        // engine does not support streams yet.
        if (data instanceof ReadableStream) {
            const reader = data.getReader();
            const decoder = new TextDecoder();

            let sql = "";

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                sql += decoder.decode(value, { stream: true });
            }

            return this.#broker.importSql(sql + decoder.decode());
        }

        // NOTE We currently convert blobs into strings as the
        // engine does not support blobs yet.
        if (data instanceof Blob) {
            return this.#broker.importSql(await data.text());
        }

        return this.#broker.importSql(data);
    }

    override async exportSql(options: Partial<SqlExportOptions>): Promise<Response> {
        const payload = wrapSqonError(() => this._context.codecs.cbor.encode(options));
        const sql = await this.#broker.exportSql(payload);

        return new Response(sql);
    }

    async #initialize(state: ConnectionState, signal: AbortSignal) {
        try {
            await this.#broker.connect(state.url.toString(), this.#options, (data) => {
                const payload = wrapSqonError(() =>
                    this._context.codecs.cbor.decode<LivePayload>(data),
                );

                if (payload.id) {
                    this.#live.dispatch(
                        payload.id.toString(),
                        payload.action === "KILLED"
                            ? { queryId: payload.id, action: "KILLED" }
                            : {
                                  queryId: payload.id,
                                  action: payload.action,
                                  recordId: payload.record as RecordId,
                                  value: payload.result as Record<string, unknown>,
                              },
                    );
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
