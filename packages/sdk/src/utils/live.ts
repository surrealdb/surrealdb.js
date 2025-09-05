import type { ConnectionController } from "../controller";
import { ConnectionUnavailable, LiveSubscriptionFailed, SurrealError } from "../errors";
import { ChannelIterator } from "../internal/channel-iterator";
import { Query } from "../query";
import type { LiveMessage, LiveResource } from "../types";
import type { Uuid } from "../value";
import { BoundQuery } from "./bound-query";
import type { Publisher } from "./publisher";

type ErrorPublisher = Publisher<{
    error: [Error];
}>;

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
    #query: Query;
    #killed = false;
    #publisher: ErrorPublisher;
    #channels: Set<ChannelIterator<LiveMessage>> = new Set();
    #unsubscribe: () => void;

    constructor(
        publisher: ErrorPublisher,
        controller: ConnectionController,
        resource: LiveResource,
        query: Query,
    ) {
        super();
        this.#publisher = publisher;
        this.#controller = controller;
        this.#resource = resource;
        this.#query = query;

        this.#unsubscribe = this.#controller.subscribe("connected", () => {
            this.#listen();
        });

        if (this.#controller.status === "connected") {
            this.#listen();
        }
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
        return !this.#killed;
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
                json: false,
            });
        }
    }

    public [Symbol.asyncIterator](): AsyncIterator<LiveMessage> {
        if (this.#killed) {
            throw new SurrealError("Subscription has been killed");
        }

        const channel = new ChannelIterator<LiveMessage>(() => {
            this.#channels.delete(channel);
        });

        this.#channels.add(channel);

        return channel;
    }

    async #listen(): Promise<void> {
        try {
            const [id] = await this.#query.collect<[Uuid]>();

            this.#currentId = id;

            const messageStream = this.#controller.liveQuery(id);

            for await (const message of messageStream) {
                for (const channel of this.#channels) {
                    channel.submit(message);
                }
            }
        } catch (err: unknown) {
            this.#publisher.publish("error", new LiveSubscriptionFailed(err));
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
    #killed = false;
    #channels: Set<ChannelIterator<LiveMessage>> = new Set();

    constructor(controller: ConnectionController, id: Uuid) {
        super();
        this.#controller = controller;
        this.#id = id;

        if (this.#controller.status !== "connected") {
            throw new ConnectionUnavailable();
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
        return !this.#killed;
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
                json: false,
            });
        }
    }

    public [Symbol.asyncIterator](): AsyncIterator<LiveMessage> {
        if (this.#killed) {
            throw new SurrealError("Subscription has been killed");
        }

        const channel = new ChannelIterator<LiveMessage>(() => {
            this.#channels.delete(channel);
        });

        this.#channels.add(channel);

        return channel;
    }
}
