import {
    ConnectionUnavailable,
    EngineDisconnected,
    ReconnectExhaustion,
    ResponseError,
    UnexpectedConnectionError,
    UnexpectedServerResponse,
} from "../errors";
import { ChannelIterator } from "../internal/channel-iterator";
import { getIncrementalID } from "../internal/get-incremental-id";
import type { LiveAction, LiveMessage, RpcRequest, RpcResponse } from "../types";
import { LIVE_ACTIONS } from "../types/live";
import type { ConnectionState, EngineEvents, SurrealEngine } from "../types/surreal";
import { Publisher } from "../utils/publisher";
import { RecordId, Uuid } from "../value";
import { JsonEngine } from "./json";

type Interval = Parameters<typeof clearInterval>[0];
type Response = Record<string, unknown>;

interface Call<T> {
    request: object;
    resolve: (value: T) => void;
    reject: (error: Error) => void;
}

type LiveChannels = Record<string, [LiveMessage]>;

interface LivePayload {
    id: Uuid;
    action: LiveAction;
    result: LiveMessage;
    record: RecordId;
}

/**
 * An engine that communicates over WebSocket protocol
 */
export class WebSocketEngine extends JsonEngine implements SurrealEngine {
    #publisher = new Publisher<EngineEvents>();
    #socket: WebSocket | undefined;
    #calls = new Map<string, Call<unknown>>();
    #subscriptions = new Publisher<LiveChannels>();
    #pinger: Interval;
    #active = false;
    #terminated = false;

    subscribe<K extends keyof EngineEvents>(
        event: K,
        listener: (...payload: EngineEvents[K]) => void,
    ): () => void {
        return this.#publisher.subscribe(event, listener);
    }

    open(state: ConnectionState): void {
        this.#publisher.publish("connecting");
        this.#terminated = false;
        this._state = state;

        const { reconnect } = state;

        (async () => {
            while (true) {
                // Open a new socket and await until closure
                const error = await this.createSocket(() => {
                    this.#active = true;
                    reconnect.reset();

                    for (const { request } of this.#calls.values()) {
                        this.#socket?.send(this._context.encode(request));
                    }

                    this.#publisher.publish("connected");
                });

                this.#socket = undefined;

                if (error) {
                    this.#publisher.publish("error", error);
                }

                // Check if we should continue to iterate and reconnect
                if (this.#terminated || !reconnect.enabled || !reconnect.allowed) {
                    // Propagate reconnect exhaustion
                    if (reconnect.enabled && !reconnect.allowed) {
                        this.#publisher.publish("error", new ReconnectExhaustion());
                    }

                    // Optionally terminate pending calls
                    if (!this.#terminated) {
                        for (const { reject } of this.#calls.values()) {
                            reject(new EngineDisconnected());
                        }
                    }

                    this._state = undefined;
                    this.#active = false;
                    this.#calls.clear();
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
        this._state = undefined;
        this.#terminated = true;
        this.#socket?.close();

        if (this.#active) {
            await this.#publisher.subscribeFirst("disconnected");
        }
    }

    override send<Method extends string, Params extends unknown[] | undefined, Result>(
        request: RpcRequest<Method, Params>,
    ): Promise<Result> {
        return new Promise((resolve, reject) => {
            if (!this.#active) {
                reject(new ConnectionUnavailable());
                return;
            }

            const id = getIncrementalID();
            const call: Call<Result> = {
                request: { id, ...request },
                resolve,
                reject,
            };

            this.#calls.set(id, call as Call<unknown>);
            this.#socket?.send(this._context.encode(call.request));
        });
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

    private async createSocket(onConnected: () => void): Promise<Error | null> {
        return new Promise((resolve, reject) => {
            if (!this._state) {
                reject(new ConnectionUnavailable());
                return;
            }

            // Open a new connection
            const WebSocketImpl = this._context.options.websocketImpl ?? WebSocket;
            const socket = new WebSocketImpl(this._state.url.toString(), "cbor");
            if (socket.binaryType === "blob") socket.binaryType = "arraybuffer";

            this.#socket = socket;

            // Store connection errors
            let caughtError: Error | null = null;

            // Wait for the connection to open
            socket.addEventListener("open", () => {
                try {
                    onConnected();

                    this.#pinger = setInterval(() => {
                        try {
                            this.send({ method: "ping" });
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
                    const decoded = this._context.decode<Response>(buffer);

                    if (
                        typeof decoded === "object" &&
                        decoded != null &&
                        Object.getPrototypeOf(decoded) === Object.prototype
                    ) {
                        this.handleRpcResponse(decoded);
                    } else {
                        throw new UnexpectedServerResponse(decoded);
                    }
                } catch (detail) {
                    socket.dispatchEvent(new CustomEvent("error", { detail }));
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

        throw new UnexpectedServerResponse(data);
    }

    private handleRpcResponse({ id, ...res }: Response) {
        if (typeof id === "string") {
            try {
                const response = res as RpcResponse<unknown>;
                const { resolve, reject } = this.#calls.get(id) ?? {};

                if (response.error) {
                    reject?.(new ResponseError(response.error));
                } else {
                    resolve?.(response.result);
                }
            } finally {
                this.#calls.delete(id);
            }
            return;
        }

        if (isLiveMessage(res.result)) {
            this.#subscriptions.publish(res.result.id.toString(), {
                queryId: res.result.id,
                action: res.result.action,
                recordId: res.result.record,
                value: res.result.result,
            });
            return;
        }

        this.#publisher.publish("error", new UnexpectedServerResponse(res));
    }
}

function isLiveMessage(v: unknown): v is LivePayload {
    if (typeof v !== "object") return false;
    if (v === null) return false;
    if (!("id" in v && "action" in v && "result" in v && "record" in v)) return false;

    if (!(v.id instanceof Uuid)) return false;
    if (!LIVE_ACTIONS.includes(v.action as LiveAction)) return false;
    if (typeof v.result !== "object") return false;
    if (v.result === null) return false;
    if (!(v.record instanceof RecordId)) return false;

    return true;
}
