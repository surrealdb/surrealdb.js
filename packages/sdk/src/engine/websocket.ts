import { RecordId, Uuid } from "@surrealdb/sqon";
import {
    CallTerminatedError,
    ConnectionUnavailableError,
    ReconnectExhaustionError,
    ServerError,
    UnexpectedConnectionError,
    UnexpectedServerResponseError,
} from "../errors";
import { abortReason } from "../internal/abort";
import { parseRpcError } from "../internal/parse-error";
import {
    type Abandonment,
    isQueryStreamFrame,
    type QueryStreamFrame,
    queryStreamChunks,
} from "../internal/query-stream";
import { wrapSqonError } from "../internal/wrap-sqon-error";
import type {
    LiveAction,
    LiveMessage,
    QueryChunk,
    RpcRequest,
    RpcResponse,
    Session,
} from "../types";
import { LIVE_ACTIONS } from "../types/live";
import type {
    ConnectionState,
    EngineEvents,
    RequestOptions,
    SurrealEngine,
} from "../types/surreal";
import type { BoundQuery } from "../utils";
import { Features } from "../utils";
import { ChannelIterator } from "../utils/channel-iterator";
import { LiveDispatcher } from "../utils/live-dispatcher";
import { Publisher } from "../utils/publisher";
import { RpcEngine } from "./rpc";

type Interval = Parameters<typeof clearInterval>[0];
type Response = Record<string, unknown>;

interface Call<T> {
    request: object;
    resolve: (value: T) => void;
    reject: (error: Error) => void;
}

/**
 * One streaming query in flight, held under the request id its frames carry.
 */
interface Stream {
    channel: ChannelIterator<StreamEvent>;
    /** Whether the terminal frame, or a failure standing in for it, has arrived. */
    settled: boolean;
    /** Whether the consumer stopped reading, leaving remaining frames to discard. */
    abandoned: boolean;
}

/**
 * A frame of a streaming query answer, or the failure which ended it.
 */
type StreamEvent = { kind: "frame"; frame: QueryStreamFrame } | { kind: "error"; error: Error };

/**
 * Whether a streaming query framed anything before it failed.
 *
 * A *refusal* with no frame behind it proves the query never ran: the server frames `begin` only
 * once it has accepted the request, so an error answering the request instead of a frame means
 * nothing executed, and asking again in buffered form cannot run it twice. Nothing else is
 * proven by the absence of a frame. In particular a connection which dies is not a refusal - the
 * server enqueues `begin` ahead of executing, and a frame that never arrived does not mean one
 * was never sent - so a lost socket is never a reason to ask again.
 */
interface StreamProbe {
    framed: boolean;
}

interface LivePayload {
    id: Uuid;
    action: LiveAction;
    result?: Record<string, unknown>;
    record?: RecordId;
}

/**
 * An engine that communicates over WebSocket protocol
 */
export class WebSocketEngine extends RpcEngine implements SurrealEngine {
    #publisher = new Publisher<EngineEvents>();
    #socket: WebSocket | undefined;
    #calls = new Map<string, Call<unknown>>();
    #streams = new Map<string, Stream>();
    #live = new LiveDispatcher();
    #pinger: Interval;
    #active = false;
    #terminated = false;
    #streaming = true;

    features = new Set([
        Features.LiveQueries,
        Features.RefreshTokens,
        Features.Sessions,
        Features.Transactions,
        Features.Api,
        Features.ExportImportRaw,
        Features.SurrealML,
        Features.QueryStreaming,
    ]);

    subscribe<K extends keyof EngineEvents>(
        event: K,
        listener: (...payload: EngineEvents[K]) => void,
    ): () => void {
        return this.#publisher.subscribe(event, listener);
    }

    open(state: ConnectionState): void {
        this.#terminated = false;
        this._state = state;

        const { reconnect } = state;

        (async () => {
            while (!this.#terminated) {
                // Open a new socket and await until closure
                const error = await this.createSocket(() => {
                    this.#active = true;
                    // Whether streaming is served is a property of the server, and a reconnect
                    // can land on a different one, so each socket is asked again. What the driver
                    // was configured to do is a separate matter, read when a query is made.
                    this.#streaming = true;
                    reconnect.reset();

                    this.#publisher.publish("connected");
                });

                this.#socket = undefined;

                // The socket is gone; any notifications buffered for live
                // queries registered on it are stale and will be re-registered
                // under fresh ids if the connection is re-established.
                this.#live.clear();

                // A stream dies with its socket, whether or not it had begun to answer. It is
                // never re-sent: a consumer which holds part of the answer would see it twice,
                // and one which holds none cannot tell a query which never started from one which
                // started and was lost with the connection - re-sending the second would execute
                // it again.
                this.failStreams(new CallTerminatedError());

                if (error) {
                    this.#publisher.publish("error", error);
                }

                // Check if we should continue to iterate and reconnect
                if (this.#terminated || !reconnect.enabled || !reconnect.allowed) {
                    // Propagate reconnect exhaustion
                    if (reconnect.enabled && !reconnect.allowed) {
                        this.#publisher.publish("error", new ReconnectExhaustionError());
                    }

                    // No socket is coming back, so nothing in flight can be answered.
                    this.terminatePending(new CallTerminatedError());

                    this._state = undefined;
                    this.#active = false;
                    this.#publisher.publish("disconnected");

                    break;
                }

                // Propagate caught errors
                if (error) {
                    reconnect.propagate(error);
                }

                this.#publisher.publish("reconnecting");

                // Perform a reconnect iteration cooldown
                await reconnect.iterate();
            }
        })();
    }

    async close(): Promise<void> {
        if (this.#terminated) return;
        const WebSocketImpl = this._context.options.websocketImpl ?? globalThis.WebSocket;
        const socketState = this.#socket?.readyState;

        this._state = undefined;
        this.#terminated = true;
        this.#active = false;
        this.#socket?.close();

        // Settled here rather than when the loop above next wakes, which a reconnect cooldown
        // can hold off for as long as its backoff: a caller awaiting a query when the connection
        // is closed under it learns that it died, instead of waiting on it for the life of the
        // process.
        this.terminatePending(new CallTerminatedError());

        if (socketState === WebSocketImpl.OPEN || socketState === WebSocketImpl.CLOSING) {
            await this.#publisher.subscribeFirst("disconnected");
        } else {
            this.#publisher.publish("disconnected");
        }
    }

    ready(version?: string): void {
        // A server known to predate streaming would only be asked, and refuse, on the first query
        // of every connection. Only a version which is known to be older skips the question; one
        // which is not known, or not understood, is asked, as asking is what decides.
        if (version !== undefined && predatesStreaming(version)) {
            this.#streaming = false;
        }

        for (const { request } of this.#calls.values()) {
            this.#socket?.send(
                new Uint8Array(wrapSqonError(() => this._context.codecs.cbor.encode(request))),
            );
        }
    }

    override send<Method extends string, Params extends unknown[] | undefined, Result>(
        request: RpcRequest<Method, Params>,
        options?: RequestOptions,
    ): Promise<Result> {
        return new Promise((resolve, reject) => {
            const signal = options?.signal;

            // Nothing is sent for a request which has been abandoned already
            if (signal?.aborted) {
                reject(abortReason(signal));
                return;
            }

            if (!this.#active) {
                reject(new ConnectionUnavailableError());
                return;
            }

            const id = this._context.uniqueId();

            // Whichever way the call ends - answered, terminated, or abandoned - it stops
            // watching the signal, so a signal which outlives it does not hold on to it.
            let unwatch = () => {};

            const call: Call<Result> = {
                request: { id, ...request },
                resolve: (value) => {
                    unwatch();
                    resolve(value);
                },
                reject: (error) => {
                    unwatch();
                    reject(error);
                },
            };

            if (signal) {
                const onAbort = () => {
                    // Already answered or terminated, and so nothing left to give up on
                    if (this.#calls.get(id) !== call) return;

                    // Forgotten, so that a late response finds nobody waiting for it and is
                    // dropped, and a reconnect does not send the request again.
                    this.#calls.delete(id);

                    try {
                        this.abandon(id, call.request);
                    } catch {
                        // Failing to tell the server must not leave the caller waiting
                    }

                    reject(abortReason(signal));
                };

                signal.addEventListener("abort", onAbort, { once: true });
                unwatch = () => signal.removeEventListener("abort", onAbort);
            }

            this.#calls.set(id, call as Call<unknown>);

            try {
                this.#socket?.send(
                    new Uint8Array(
                        wrapSqonError(() => this._context.codecs.cbor.encode(call.request)),
                    ),
                );
            } catch (error) {
                // A request which could not be written is not left waiting for an answer
                this.#calls.delete(id);
                unwatch();
                throw error;
            }
        });
    }

    /**
     * Called when a pending call is given up on because its signal aborted, once it has been
     * forgotten by the engine and before the caller is told.
     *
     * By then the request has been sent, and this protocol has no way of taking it back: the server
     * carries on, and its response is ignored when it arrives. An engine whose server can be told
     * to stop what it is doing sends that here, with the id the request was sent under.
     *
     * @param _id The id the request was sent with
     * @param _request The request as it was sent
     */
    protected abandon(_id: string, _request: object): void {}

    override query<T>(
        query: BoundQuery,
        session: Session,
        txn?: Uuid,
        options?: RequestOptions,
    ): AsyncIterable<QueryChunk<T>> {
        // A query inside a client managed transaction is never streamed. The stream would execute
        // on that transaction while a `commit` for it can arrive on the same connection at any
        // time, which would commit a prefix of the query rather than the whole of it.
        //
        // Nor is one streamed with no socket to write to, which is where a reconnect cooldown
        // leaves the engine: a buffered call is queued and re-sent once the connection returns,
        // where a stream would be waiting on a request that was never written.
        //
        // Both of those, and the driver's `streaming: false`, are about a query which is streamed
        // because it can be. A caller who asked for a stream has said that it wants one, so for it
        // they do not apply: it streams inside a transaction, and in spite of the driver's wish.
        // What it cannot be given is a stream from a server which cannot stream, which is learned,
        // and which still answers it buffered.
        const requested = options?.stream === true;

        if (
            (txn !== undefined && !requested) ||
            (this._context.options.streaming === false && !requested) ||
            !this.#streaming ||
            !this.#socket
        ) {
            return super.query<T>(query, session, txn, options);
        }

        // The frames are kept to hand so that leaving the chunks can act on them at once. An
        // async generator defers a `return` until its body next wakes, and this body can be
        // parked on a frame which is not coming - a consumer racing a read against a timeout
        // would otherwise never be let go.
        const frames: { current?: AsyncIterableIterator<QueryStreamFrame> } = {};
        const abandonment: Abandonment = {};
        const chunks = this.streamChunks<T>(
            query,
            session,
            txn,
            options,
            requested,
            frames,
            abandonment,
        );

        return {
            [Symbol.asyncIterator]: () => ({
                next: () => chunks.next(),
                throw: (error?: unknown) => chunks.throw(error),
                return: (value?: QueryChunk<T>) => {
                    // Recorded before the frames are closed, so that running out of them is read
                    // as the consumer leaving rather than as a truncated answer.
                    abandonment.requested = true;
                    frames.current?.return?.(undefined);
                    return chunks.return(value as QueryChunk<T>);
                },
                [Symbol.asyncIterator]() {
                    return this;
                },
            }),
        };
    }

    /**
     * Streams a query, falling back to the buffered method if the server refuses it.
     */
    private async *streamChunks<T>(
        query: BoundQuery,
        session: Session,
        txn: Uuid | undefined,
        options: RequestOptions | undefined,
        requested: boolean,
        frames: { current?: AsyncIterableIterator<QueryStreamFrame> },
        abandonment: Abandonment,
    ): AsyncGenerator<QueryChunk<T>> {
        const probe: StreamProbe = { framed: false };

        // Opened here rather than by `query`, so nothing is sent until the caller reads.
        frames.current = this.streamFrames(query, session, txn, probe);

        try {
            for await (const chunk of queryStreamChunks<T>(frames.current, abandonment)) {
                yield chunk;
            }
        } catch (error) {
            // A stream the server refused before framing anything is asked for again in buffered
            // form: nothing is framed until execution is about to begin, so the query never ran
            // and cannot run twice. That covers a server which does not serve the method, one
            // where it is denied, and one refusing another concurrent stream.
            if (probe.framed || !isRetriableAsBuffered(error)) {
                throw error;
            }

            // Absent or denied is a property of the server rather than of this query, so it is
            // remembered for as long as the socket lasts.
            const cannotStream =
                error.code === METHOD_NOT_FOUND || error.code === METHOD_NOT_ALLOWED;

            if (cannotStream) {
                this.#streaming = false;
            }

            // A caller who asked for a stream is told when the refusal is about this one - the
            // connection being at its limit of them, say - rather than quietly served a buffered
            // answer instead. A server which cannot stream at all is a different matter: the
            // stream is a way of receiving the answer, and the answer is still wanted.
            if (requested && !cannotStream) {
                throw error;
            }

            for await (const chunk of super.query<T>(query, session, txn, options)) {
                yield chunk;
            }
        }
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

    /**
     * Sends a streaming query and returns the frames it is answered with, in order.
     *
     * The iterator acts on abandonment the moment it is asked to, rather than
     * when the frames next wake it: a stream can sit for a long time between
     * frames - or produce none at all - and a consumer which has left must not
     * wait on a frame to be let go, nor have an error delivered to it.
     */
    private streamFrames(
        query: BoundQuery,
        session: Session,
        txn: Uuid | undefined,
        probe: StreamProbe,
    ): AsyncIterableIterator<QueryStreamFrame> {
        // A stream is never re-sent once a socket returns, so it cannot be queued for one which is
        // not there: it would wait for a request never written.
        if (!this.#active || !this.#socket) {
            throw new ConnectionUnavailableError();
        }

        const id = this._context.uniqueId();
        const stream: Stream = {
            channel: new ChannelIterator<StreamEvent>(),
            settled: false,
            abandoned: false,
        };

        // Sent before the stream is registered, so a request which never reached the socket - an
        // unencodable binding, say - leaves no registration to drain and nothing to cancel. No
        // response can arrive in between: both steps are synchronous.
        this.#socket.send(
            new Uint8Array(
                wrapSqonError(() =>
                    this._context.codecs.cbor.encode({
                        id,
                        method: "query_stream",
                        params: [query.query, query.bindings],
                        session,
                        // Only when there is one: a stream inside a transaction is run on it.
                        ...(txn === undefined ? {} : { txn }),
                    }),
                ),
            ),
        );

        this.#streams.set(id, stream);

        const frames = this.readFrames(id, stream, probe);

        return {
            next: () => frames.next(),
            throw: (error) => frames.throw(error),
            return: (value?: QueryStreamFrame) => {
                this.abandonStream(id, stream);
                return frames.return(value as QueryStreamFrame);
            },
            [Symbol.asyncIterator]() {
                return this;
            },
        };
    }

    /**
     * Yields the frames of a registered stream until it ends.
     */
    private async *readFrames(
        id: string,
        stream: Stream,
        probe: StreamProbe,
    ): AsyncGenerator<QueryStreamFrame> {
        try {
            for await (const event of stream.channel) {
                if (event.kind === "error") {
                    throw event.error;
                }

                probe.framed = true;

                yield event.frame;
            }
        } finally {
            if (stream.settled) {
                this.#streams.delete(id);
            } else {
                this.abandonStream(id, stream);
            }
        }
    }

    /**
     * Gives up on a stream whose consumer has left.
     *
     * Cancelling stops the server executing a query nothing will collect, and
     * closing the channel releases a read parked on a frame which may never
     * come. The registration stays until the terminal frame settles it, so the
     * frames still in flight are discarded rather than misrouted.
     */
    private abandonStream(id: string, stream: Stream): void {
        if (stream.settled || stream.abandoned) {
            stream.channel.cancel();
            return;
        }

        stream.abandoned = true;
        stream.channel.cancel();
        this.cancelStream(id);
    }

    /**
     * Asks the server to stop a streaming query it is still executing.
     */
    private cancelStream(id: string): void {
        if (!this.#active) {
            this.#streams.delete(id);
            return;
        }

        this.send({ method: "query_cancel", params: [id] }).catch(() => {
            // The stream is already being abandoned; a cancel which cannot be delivered, or which
            // names a stream that has since ended, changes nothing for the consumer.
        });
    }

    /**
     * Fails everything in flight, for a connection which is not coming back.
     *
     * The calls and the streams are settled together: a query which reported a
     * closed connection differently for having been streamed would make the
     * two transports observably different, and one which reported nothing at
     * all would leave its caller waiting on it for the life of the process.
     */
    private terminatePending(error: Error): void {
        for (const { reject } of this.#calls.values()) {
            reject(error);
        }

        this.#calls.clear();
        this.failStreams(error);
    }

    /**
     * Fails the streaming queries in flight, as a stream cannot outlive its socket.
     */
    private failStreams(error: Error): void {
        for (const [id, stream] of this.#streams) {
            stream.settled = true;
            this.#streams.delete(id);

            if (!stream.abandoned) {
                stream.channel.submit({ kind: "error", error });
            }
        }
    }

    /**
     * Routes one response of a streaming query to the consumer waiting on it.
     */
    private handleStreamResponse(id: string, stream: Stream, response: RpcResponse<unknown>): void {
        const frame = response.error ? undefined : response.result;

        // A failure, or anything which is not a frame, is terminal: the request is answered by
        // frames until its `end`, so there is nothing further to wait for.
        if (response.error || !isQueryStreamFrame(frame)) {
            stream.settled = true;
            this.#streams.delete(id);

            if (!stream.abandoned) {
                stream.channel.submit({
                    kind: "error",
                    error: response.error
                        ? parseRpcError(response.error)
                        : new UnexpectedServerResponseError(frame),
                });
            }

            return;
        }

        if (frame.stream === "end") {
            stream.settled = true;
            this.#streams.delete(id);
        }

        if (!stream.abandoned) {
            stream.channel.submit({ kind: "frame", frame });
        }
    }

    private async createSocket(onConnected: () => void): Promise<Error | null> {
        return new Promise((resolve, reject) => {
            if (!this._state) {
                reject(new ConnectionUnavailableError());
                return;
            }

            // Open a new connection
            const WebSocketImpl = this._context.options.websocketImpl ?? globalThis.WebSocket;
            const socket = new WebSocketImpl(this._state.url.toString(), "cbor");

            // Binary frames must arrive as something parseBuffer accepts. Assert the desired
            // type rather than correcting one specific unwanted value: React Native leaves
            // binaryType uninitialised, so its getter returns null and `=== "blob"` never fires.
            if (socket.binaryType !== "arraybuffer") {
                socket.binaryType = "arraybuffer";
            }

            this.#socket = socket;

            // Store connection errors
            let caughtError: Error | null = null;

            // Wait for the connection to open
            socket.addEventListener("open", () => {
                try {
                    onConnected();

                    this.#pinger = setInterval(() => {
                        try {
                            // A ping in flight is terminated with every other call when the
                            // connection goes, and its rejection belongs to nobody.
                            this.send({ method: "ping" }).catch(() => {});
                        } catch {
                            // we are not interested in the result
                        }
                    }, 30_000);
                } catch (err: unknown) {
                    caughtError = err as Error;
                    socket.close();
                }
            });

            // Handle any errors
            socket.addEventListener("error", (e) => {
                const error = new UnexpectedConnectionError(
                    "detail" in e && e.detail
                        ? e.detail
                        : "message" in e && e.message
                          ? e.message
                          : "error" in e && e.error
                            ? e.error
                            : "An unexpected error occurred",
                );

                caughtError = error;
            });

            // Handle connection closure
            socket.addEventListener("close", () => {
                clearInterval(this.#pinger);
                resolve(caughtError);
            });

            // Handle any messages
            socket.addEventListener("message", ({ data }) => {
                try {
                    const buffer = this.parseBuffer(data);
                    const decoded = wrapSqonError(() =>
                        this._context.codecs.cbor.decode<Response>(buffer),
                    );

                    if (
                        typeof decoded === "object" &&
                        decoded != null &&
                        Object.getPrototypeOf(decoded) === Object.prototype
                    ) {
                        this.handleRpcResponse(decoded);
                    } else {
                        throw new UnexpectedServerResponseError(decoded);
                    }
                } catch (cause) {
                    // Report malformed frames on the engine's own error channel, as
                    // handleRpcResponse already does for unrecognised frames. Round-tripping
                    // through a synthetic CustomEvent required a global which does not exist in
                    // every runtime (React Native), was rejected by event-target-shim based
                    // EventTarget implementations, and only stashed the error in caughtError -
                    // deferring it until the socket closed and then misreporting it as the cause
                    // of that closure.
                    try {
                        this.#publisher.publish("error", new UnexpectedConnectionError(cause));
                    } catch {
                        // A throwing subscriber must not escape the socket listener
                    }
                }
            });
        });
    }

    private parseBuffer(data: unknown) {
        if (data instanceof Uint8Array) {
            return data;
        }

        if (data instanceof ArrayBuffer) {
            return new Uint8Array(data);
        }

        throw new UnexpectedServerResponseError(data);
    }

    private handleRpcResponse({ id, ...res }: Response) {
        if (typeof id === "string") {
            // Frames are only ever decoded behind the id of a stream this engine started, never
            // by the shape of a payload, which user data could imitate.
            const stream = this.#streams.get(id);

            if (stream) {
                this.handleStreamResponse(id, stream, res as RpcResponse<unknown>);
                return;
            }

            try {
                const response = res as RpcResponse<unknown>;
                const { resolve, reject } = this.#calls.get(id) ?? {};

                if (response.error) {
                    reject?.(parseRpcError(response.error));
                } else {
                    resolve?.(response.result);
                }
            } finally {
                this.#calls.delete(id);
            }
            return;
        }

        if (isLiveMessage(res.result)) {
            const frame = res.result;
            this.#live.dispatch(
                frame.id.toString(),
                frame.action === "KILLED"
                    ? { queryId: frame.id, action: "KILLED" }
                    : {
                          queryId: frame.id,
                          action: frame.action,
                          recordId: frame.record as RecordId,
                          value: frame.result as Record<string, unknown>,
                      },
            );
            return;
        }

        this.#publisher.publish("error", new UnexpectedServerResponseError(res));
    }
}

/**
 * Whether a streaming query which framed nothing can be asked for again as a buffered one.
 *
 * Only a rejection by the server: it leaves the query unexecuted and the connection intact, so
 * the buffered path can answer it straight away. A connection which went away is reported as it
 * is instead of being asked for again, even though a buffered call would have been queued and
 * re-sent, because the second request would have to be started from a stream whose consumer may
 * be walking away at that very moment, leaving its rejection with nowhere to go.
 */
function isRetriableAsBuffered(error: unknown): error is ServerError {
    return error instanceof ServerError;
}

/**
 * Whether a version is known to be older than the first to serve streaming queries.
 *
 * "Known" is the point: a version which does not begin with numbers - or is absent - is not one
 * that is known to be older, and is asked. Nor is this the feature's own `supports`, which
 * compares strings, so that anything which does not begin with a digit sorts past every number,
 * and which also refuses a version newer than the range this SDK is tested against: a bound which
 * says nothing about streaming, as a server newer than the SDK should still be asked.
 *
 * A prerelease is compared by the release it leads up to, as one of the release which introduced
 * streaming may or may not have it, and the question settles that.
 */
function predatesStreaming(version: string): boolean {
    const since = Features.QueryStreaming.sinceVersion;
    const have = releaseOf(version);
    const first = since === undefined ? undefined : releaseOf(since);

    if (!have || !first) return false;

    for (let index = 0; index < 3; index++) {
        if (have[index] !== first[index]) return have[index] < first[index];
    }

    return false;
}

/** The major, minor and patch of a version, or nothing when it does not begin with them. */
function releaseOf(version: string): [number, number, number] | undefined {
    const match = /^(?:surrealdb-)?v?(\d+)\.(\d+)(?:\.(\d+))?/.exec(version.trim());

    return match ? [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)] : undefined;
}

/** The wire code for a method a server does not serve. */
const METHOD_NOT_FOUND = -32601;

/** The wire code for a method a server serves but does not allow. */
const METHOD_NOT_ALLOWED = -32602;

function isLiveMessage(v: unknown): v is LivePayload {
    if (typeof v !== "object") return false;
    if (v === null) return false;
    if (!("id" in v && "action" in v)) return false;

    if (!(v.id instanceof Uuid)) return false;
    if (!LIVE_ACTIONS.includes(v.action as LiveAction)) return false;

    // A KILLED frame terminates the subscription and carries no record or value.
    if (v.action === "KILLED") return true;

    if (!("result" in v && "record" in v)) return false;
    if (typeof v.result !== "object") return false;
    if (v.result === null) return false;
    if (!(v.record instanceof RecordId)) return false;

    return true;
}
