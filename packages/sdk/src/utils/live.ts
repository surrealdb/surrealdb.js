import type { Uuid } from "@surrealdb/sqon";
import type { ConnectionController } from "../controller";
import { ConnectionUnavailableError, LiveSubscriptionError } from "../errors";
import { Query } from "../query";
import type { LiveMessage, LiveResource, Session } from "../types";
import { BoundQuery } from "./bound-query";
import { ChannelIterator } from "./channel-iterator";

// Kill does not compute paramters yet :(
function newKill(id: Uuid): BoundQuery {
    return new BoundQuery(`KILL u"${id.toString()}"`);
}

/**
 * Represents a subscription to a LIVE SELECT query
 */
export abstract class LiveSubscription implements AsyncIterable<LiveMessage> {
    /**
     * The ID of the live subscription. Note that this id might change after
     * a live query has been restarted.
     */
    abstract get id(): Uuid;

    /**
     * Returns whether this LiveQuery is managed by the driver and may be automatically
     * restarted once the connection is re-established.
     */
    abstract get isManaged(): boolean;

    /**
     * The live resource that this subscription is tracking, if any.
     */
    abstract get resource(): LiveResource | undefined;

    /**
     * Whether the LiveQuery is considered alive. Although the connection may be
     * disconnected, the LiveQuery may still be alive if it is managed by the driver.
     */
    abstract get isAlive(): boolean;

    /**
     * Kill the live subscription and stop receiving updates
     */
    abstract kill(): Promise<void>;

    /**
     * The async iterator for the live subscription
     */
    abstract [Symbol.asyncIterator](): AsyncIterator<LiveMessage>;

    /**
     * Subscribe to the live subscription and return an unsubscribe function
     */
    public subscribe(handler: (message: LiveMessage) => void): () => void {
        let killed = false;

        (async () => {
            for await (const message of this) {
                if (killed) {
                    return;
                }

                handler(message);
            }
        })();

        return () => {
            killed = true;
        };
    }
}

/**
 * A managed live subscription that is automatically restarted when the connection
 * is re-established.
 */
export class ManagedLiveSubscription extends LiveSubscription {
    #currentId!: Uuid;
    #controller: ConnectionController;
    #resource: LiveResource;
    #session: Session;
    #query: Query;
    #killed = false;
    #channels: Set<ChannelIterator<LiveMessage>> = new Set();
    #unsubscribe: () => void;
    #ready: Promise<void> = Promise.resolve();

    constructor(
        controller: ConnectionController,
        resource: LiveResource,
        session: Session,
        query: Query,
    ) {
        super();
        this.#controller = controller;
        this.#resource = resource;
        this.#session = session;
        this.#query = query;

        this.#unsubscribe = this.#controller.subscribe("connected", () => {
            // Re-establish the subscription in the background on reconnect.
            this.#listen().catch(() => {
                // Errors are already surfaced via propagateError inside #listen.
            });
        });

        if (this.#controller.status === "connected") {
            this.#ready = this.#listen();
        }
    }

    /**
     * Resolves once the live query has been registered on the server and this
     * client is subscribed to its notification stream. Callers can await this
     * before issuing writes to guarantee no notification is missed.
     */
    public ready(): Promise<void> {
        return this.#ready;
    }

    public get id(): Uuid {
        return this.#currentId;
    }

    public get isManaged(): boolean {
        return true;
    }

    public get resource(): LiveResource {
        return this.#resource;
    }

    public get isAlive(): boolean {
        // Alive until permanent teardown: killed explicitly, the owning session
        // destroyed, or the connection closed for good. hasSession() stays true
        // across a transient reconnect, whose state is not cleared.
        return !this.#killed && this.#controller.hasSession(this.#session);
    }

    public async kill(): Promise<void> {
        this.#killed = true;

        for (const channel of this.#channels) {
            channel.cancel();
        }

        this.#unsubscribe();

        if (this.id) {
            await new Query(this.#controller, {
                query: newKill(this.id),
                transaction: undefined,
                session: this.#session,
                json: false,
            });
        }
    }

    public [Symbol.asyncIterator](): AsyncIterator<LiveMessage> {
        if (this.#killed) {
            throw new LiveSubscriptionError("Subscription has been killed");
        }

        const channel = new ChannelIterator<LiveMessage>(() => {
            this.#channels.delete(channel);
        });

        this.#channels.add(channel);

        return channel;
    }

    async #listen(): Promise<void> {
        let messageStream: AsyncIterable<LiveMessage>;

        try {
            const [id] = await this.#query.collect<[Uuid]>();

            this.#currentId = id;

            // Subscribe to the notification stream immediately after the query
            // resolves. The engine buffers any notification that arrived before
            // this point, so the window between server registration and this
            // subscription cannot drop notifications.
            messageStream = this.#controller.liveQuery(id);
        } catch (err: unknown) {
            const error = new LiveSubscriptionError(err);
            this.#controller.propagateError(error);
            throw error;
        }

        // Fan out notifications to consumers in the background; the round-trip
        // is complete, so #listen (and thus ready()) may resolve now.
        void this.#consume(messageStream);
    }

    async #consume(messageStream: AsyncIterable<LiveMessage>): Promise<void> {
        try {
            for await (const message of messageStream) {
                for (const channel of this.#channels) {
                    channel.submit(message);
                }
            }
        } catch (err: unknown) {
            this.#controller.propagateError(new LiveSubscriptionError(err));
        }
    }
}

/**
 * An unmanaged live subscription which is constructed with only
 * a known pre-existing ID. This subscription will not be automatically
 * restarted when the connection is re-established.
 */
export class UnmanagedLiveSubscription extends LiveSubscription {
    #id: Uuid;
    #controller: ConnectionController;
    #session: Session;
    #killed = false;
    #channels: Set<ChannelIterator<LiveMessage>> = new Set();

    constructor(controller: ConnectionController, session: Session, id: Uuid) {
        super();
        this.#controller = controller;
        this.#session = session;
        this.#id = id;

        if (this.#controller.status !== "connected") {
            throw new ConnectionUnavailableError();
        }

        (async () => {
            const messageStream = controller.liveQuery(id);

            for await (const message of messageStream) {
                for (const channel of this.#channels) {
                    channel.submit(message);
                }
            }

            for (const channel of this.#channels) {
                channel.cancel();
            }
        })();
    }

    public get id(): Uuid {
        return this.#id;
    }

    public get isManaged(): boolean {
        return false;
    }

    public get resource(): undefined {
        return undefined;
    }

    public get isAlive(): boolean {
        // Alive until permanent teardown: killed explicitly, the owning session
        // destroyed, or the connection closed for good. hasSession() stays true
        // across a transient reconnect, whose state is not cleared.
        return !this.#killed && this.#controller.hasSession(this.#session);
    }

    public async kill(): Promise<void> {
        this.#killed = true;

        for (const channel of this.#channels) {
            channel.cancel();
        }

        if (this.id) {
            await new Query(this.#controller, {
                query: newKill(this.id),
                transaction: undefined,
                session: this.#session,
                json: false,
            });
        }
    }

    public [Symbol.asyncIterator](): AsyncIterator<LiveMessage> {
        if (this.#killed) {
            throw new LiveSubscriptionError("Subscription has been killed");
        }

        const channel = new ChannelIterator<LiveMessage>(() => {
            this.#channels.delete(channel);
        });

        this.#channels.add(channel);

        return channel;
    }
}
