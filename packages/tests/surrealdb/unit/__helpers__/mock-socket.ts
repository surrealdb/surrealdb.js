import { CborCodec, ShapedCodec } from "@surrealdb/sqon";
import type { ConnectionState, DriverContext, DriverOptions } from "surrealdb";
import { ReconnectContext } from "../../../../sdk/src/internal/reconnect";
import { DEFAULT_RETRY_OPTIONS } from "../../../../sdk/src/internal/retry";

/** A request as it arrived over the mocked socket. */
export interface MockRequest {
    id: string;
    method: string;
    params?: unknown[];
    txn?: unknown;
    session?: unknown;
}

type Listener = (event: unknown) => void;

const codec = new CborCodec({});
const codec2 = new CborCodec({ version: 2 });
// `shaped` is cbor.2 on the wire; a mock server writes blocks as raw bytes with `respondRaw`
const codecShaped = new ShapedCodec({});

/**
 * A `WebSocket` implementation which hands every request to a test provided
 * handler and lets it answer with any number of responses, or none at all.
 *
 * The engine is driven over its real transport this way: requests are encoded
 * and responses decoded by the same codec a server would use, so frame
 * ordering, correlation by request id, cancellation and what happens to a
 * response nobody is waiting for any longer are all exercised for real.
 */
export class MockSocket {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSING = 2;
    static readonly CLOSED = 3;

    /** Every socket opened since the last `reset`, newest last. */
    static sockets: MockSocket[] = [];

    /** Answers each request. Assigned per test. */
    static handler: ((socket: MockSocket, request: MockRequest) => void) | undefined;

    /** The subprotocol the mock server picks when it is offered: plain cbor unless a test assigns it */
    static picks = "cbor";

    /** Fail the handshake of a socket offered more than one subprotocol, as some runtimes do */
    static refusesLists = false;

    /**
     * Fail the handshake of a socket which offers a subprotocol the mock server does not know,
     * as a server before 4.0 does when a client offers `shaped`.
     */
    static knows: string[] | undefined;

    static reset(): void {
        MockSocket.sockets = [];
        MockSocket.handler = undefined;
        MockSocket.picks = "cbor";
        MockSocket.refusesLists = false;
        MockSocket.knows = undefined;
    }

    /** The socket most recently opened. */
    static get current(): MockSocket {
        const socket = MockSocket.sockets.at(-1);
        if (!socket) throw new Error("No socket has been opened");
        return socket;
    }

    readyState: number = MockSocket.CONNECTING;
    binaryType = "arraybuffer";

    /** Every request received, in order. */
    readonly requests: MockRequest[] = [];

    #listeners = new Map<string, Set<Listener>>();

    /** The subprotocols the engine offered, in its order of preference */
    readonly offered: string[];

    /** The subprotocol the mock server picked, or an empty string when it picked none */
    readonly protocol: string;

    constructor(
        readonly url: string,
        protocols?: string | string[],
    ) {
        this.offered = protocols === undefined ? [] : [protocols].flat();
        this.protocol = this.offered.includes(MockSocket.picks) ? MockSocket.picks : "";
        MockSocket.sockets.push(this);

        queueMicrotask(() => {
            if (this.readyState !== MockSocket.CONNECTING) return;
            if (MockSocket.refusesLists && this.offered.length > 1) {
                this.readyState = MockSocket.CLOSED;
                this.#emit("close", { code: 1002, reason: "Mismatch client protocol" });
                return;
            }
            if (
                MockSocket.knows &&
                !this.offered.some((name) => MockSocket.knows?.includes(name))
            ) {
                this.readyState = MockSocket.CLOSED;
                this.#emit("close", { code: 1002, reason: "Unknown subprotocol" });
                return;
            }
            this.readyState = MockSocket.OPEN;
            this.#emit("open", {});
        });
    }

    addEventListener(type: string, listener: Listener): void {
        const listeners = this.#listeners.get(type) ?? new Set();
        listeners.add(listener);
        this.#listeners.set(type, listeners);
    }

    removeEventListener(type: string, listener: Listener): void {
        this.#listeners.get(type)?.delete(listener);
    }

    send(data: Uint8Array): void {
        const request = this.#codec.decode<MockRequest>(new Uint8Array(data));
        this.requests.push(request);
        MockSocket.handler?.(this, request);
    }

    close(): void {
        if (this.readyState === MockSocket.CLOSED) return;
        this.readyState = MockSocket.CLOSED;
        this.#emit("close", {});
    }

    /** Delivers one response to the engine, as an arraybuffer socket would. */
    respond(response: object): void {
        const encoded = new Uint8Array(this.#codec.encode(response));
        const buffer = encoded.buffer.slice(
            encoded.byteOffset,
            encoded.byteOffset + encoded.byteLength,
        );

        this.#emit("message", { data: buffer });
    }

    /** Delivers one response already written as bytes, for a block a codec will not encode */
    respondRaw(bytes: Uint8Array): void {
        const copy = new Uint8Array(bytes);
        this.#emit("message", { data: copy.buffer });
    }

    /** The codec of the subprotocol picked, as a server would use it */
    get #codec(): CborCodec {
        if (this.protocol === "shaped") return codecShaped;
        return this.protocol === "cbor.2" ? codec2 : codec;
    }

    /** The requests received for a given method. */
    requestsFor(method: string): MockRequest[] {
        return this.requests.filter((request) => request.method === method);
    }

    emit(type: string, event: object = {}): void {
        this.#emit(type, event);
    }

    #emit(type: string, event: object): void {
        for (const listener of this.#listeners.get(type) ?? []) {
            listener(event);
        }
    }
}

/**
 * A driver context wired to the mocked socket.
 */
export function mockContext(options: Partial<DriverOptions> = {}): DriverContext {
    let id = 0;

    return {
        options: {
            websocketImpl: MockSocket as unknown as typeof WebSocket,
            ...options,
        },
        uniqueId: () => `req-${++id}`,
        codecs: {
            cbor: codec,
            flatbuffer: undefined as never,
            json: undefined as never,
        },
    };
}

/**
 * A connection state for the mocked socket. Reconnect is off unless a test is
 * about what happens across sockets, as a mocked socket only ever closes
 * because a test closed it.
 */
export function mockState(
    reconnect: boolean | { retryDelay?: number; retryDelayMax?: number } = false,
    extra: Partial<ConnectionState> = {},
): ConnectionState {
    return {
        url: new URL("ws://localhost:8000/rpc"),
        reconnect: new ReconnectContext(
            typeof reconnect === "boolean"
                ? reconnect
                : { enabled: true, retryDelay: 1, retryDelayMax: 1, ...reconnect },
        ),
        retry: DEFAULT_RETRY_OPTIONS,
        rootSession: {
            id: undefined,
            namespace: "test",
            database: "test",
            accessToken: undefined,
            refreshToken: undefined,
            variables: {},
            authRenewal: undefined,
            authOverriden: false,
        },
        sessions: new Map(),
        ...extra,
    };
}
