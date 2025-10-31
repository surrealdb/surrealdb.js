import { CborCodec } from "./cbor";
import { ConnectionController } from "./controller";
import { SurrealError, UnavailableFeatureError, UnsupportedFeatureError } from "./errors";
import { FlatBufferCodec } from "./flatbuffer/codec";
import type { Feature } from "./internal/feature";
import { getIncrementalID } from "./internal/get-incremental-id";
import { parseEndpoint } from "./internal/http";
import { type SessionEvents, SurrealSession } from "./session";
import type {
    CodecRegistry,
    ConnectionStatus,
    ConnectOptions,
    DriverOptions,
    EventPublisher,
    SqlExportOptions,
    VersionInfo,
} from "./types";
import { Publisher } from "./utils/publisher";
import type { Uuid } from "./value";

export type SurrealEvents = SessionEvents & {
    connecting: [];
    connected: [];
    reconnecting: [];
    disconnected: [];
    error: [Error];
};

/**
 * The Surreal class provides methods to connect to a SurrealDB instance,
 * execute database queries, subscribe to events, and manage database sessions.
 *
 * Note that most methods in this class are dispatched once you subscribe to the
 * returned Promise and offer various chainable configuration methods before
 * making the actual request.
 *
 * By default the Surreal instance is scoped to a default session, however you
 * can create a new session by calling the `startSession` or `forkSession` methods.
 */
export class Surreal extends SurrealSession implements EventPublisher<SurrealEvents> {
    readonly #publisher = new Publisher<SurrealEvents>();
    readonly #connection: ConnectionController;

    override subscribe<K extends keyof SurrealEvents>(
        event: K,
        listener: (...payload: SurrealEvents[K]) => void,
    ): () => void {
        return this.#publisher.subscribe(event, listener);
    }

    /**
     * Construct a new Surreal instance with the provided options
     *
     * @param options Driver wide configuration options
     */
    constructor(options?: DriverOptions) {
        const driverOptions = options ?? {};
        const connection = new ConnectionController({
            options: driverOptions,
            uniqueId: getIncrementalID,
            codecs: Surreal.#compileCodecs(driverOptions),
        });

        super(connection, undefined);

        connection.subscribe("connecting", () => {
            this.#publisher.publish("connecting");
        });

        connection.subscribe("connected", () => {
            this.#publisher.publish("connected");
        });

        connection.subscribe("disconnected", () => {
            this.#publisher.publish("disconnected");
        });

        connection.subscribe("reconnecting", () => {
            this.#publisher.publish("reconnecting");
        });

        connection.subscribe("error", (error) => {
            this.#publisher.publish("error", error);
        });

        super.subscribe("auth", (token) => {
            this.#publisher.publish("auth", token);
        });

        super.subscribe("using", (using) => {
            this.#publisher.publish("using", using);
        });

        this.#connection = connection;
    }

    static #compileCodecs(options: DriverOptions): CodecRegistry {
        const userCodecs = options.codecs ?? {};
        const codecOptions = options.codecOptions ?? {};

        return {
            cbor: userCodecs.cbor?.(codecOptions) ?? new CborCodec(codecOptions),
            flatbuffer: userCodecs.flatbuffer?.(codecOptions) ?? new FlatBufferCodec(codecOptions),
        };
    }

    /**
     * Returns the status of the connection
     */
    get status(): ConnectionStatus {
        return this.#connection.status;
    }

    /**
     * Returns whether the connection is considered connected
     *
     * Equivalent to `this.status === "connected"`
     */
    get isConnected(): boolean {
        return this.#connection.status === "connected";
    }

    /**
     * A promise which resolves when the connection is ready, or rejects
     * if a connection error occurs.
     */
    get ready(): Promise<void> {
        return this.#connection.ready();
    }

    // =========================================================== //
    //                                                             //
    //                     Connection Methods                      //
    //                                                             //
    // =========================================================== //

    /**
     * Connect to a local or remote SurrealDB instance using the provided URL.
     *
     * Calling `connect()` will reset and dispose any existing sessions created with `startSession()`.
     *
     * @param url The endpoint to connect to
     * @param opts Options to configure the connection
     */
    async connect(url: string | URL, opts: ConnectOptions = {}): Promise<true> {
        return this.#connection.connect(parseEndpoint(url), opts);
    }

    /**
     * Disconnect from the active SurrealDB instance
     */
    async close(): Promise<true> {
        return this.#connection.disconnect();
    }

    /**
     * Check the health of the connected SurrealDB instance
     *
     * @returns The health of the connected SurrealDB instance
     */
    health(): Promise<void> {
        return this.#connection.health();
    }

    /**
     * Retrieves the version of the connected SurrealDB instance
     *
     * @example { version: "surrealdb-2.1.0" }
     */
    version(): Promise<VersionInfo> {
        return this.#connection.version();
    }

    /**
     * Checks whether a feature is available in the current connection
     *
     * @param feature The feature to check
     */
    isFeatureSupported(feature: Feature): boolean {
        try {
            this.#connection.assertFeature(feature);
            return true;
        } catch (error) {
            if (
                error instanceof UnavailableFeatureError ||
                error instanceof UnsupportedFeatureError
            ) {
                return false;
            }

            throw error;
        }
    }

    // =========================================================== //
    //                                                             //
    //                  Session Management Methods                 //
    //                                                             //
    // =========================================================== //

    /**
     * Lists all sessions created on the current connection.
     *
     * @returns A list of active session IDs
     */
    sessions(): Promise<Uuid[]> {
        return this.#connection.sessions();
    }

    /**
     * Create a fresh new session on this connection and return a dedicated `Surreal` instance scoped to it.
     *
     * This session will contain its own copy of global variables, namespace, database, and authentication state.
     * Connection related functions and event subscriptions will be shared with the original session. When the
     * connection reconnects, the session will be automatically restored.
     *
     * You can invoke `reset()` on the created session to destroy it, after which it cannot be used again.
     *
     * If you pass `true` for the `clone` parameter, the new session will contain a copy of the global state of the current session,
     * including the namespace, database, variables, and authentication state.
     *
     * @returns The new session
     */
    async newSession(): Promise<SurrealSession> {
        const created = await this.#connection.createSession(null);

        return SurrealSession.of(this, created);
    }

    /**
     * **NOTE:** Do not call this method on the root session because it will throw an error.
     *
     * Stops the current session and disposes of it. After this method is called, the session cannot be used again,
     * and `isValid` will return `false`.
     */
    override async stopSession(): Promise<void> {
        throw new SurrealError("The root session cannot be stopped");
    }

    // =========================================================== //
    //                                                             //
    //                  Data Management Methods                    //
    //                                                             //
    // =========================================================== //

    /**
     * Export the database and return the result as a string
     *
     * @param options Optional export options
     */
    public async export(options?: Partial<SqlExportOptions>): Promise<string> {
        await this.ready;
        return this.#connection.exportSql(options ?? {});
    }

    /**
     * Import an existing export into the database
     *
     * @param input The data to import
     */
    public async import(input: string): Promise<void> {
        await this.ready;
        return this.#connection.importSql(input);
    }
}
