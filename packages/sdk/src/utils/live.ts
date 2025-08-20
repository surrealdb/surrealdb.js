import type { ConnectionController } from "../controller";
import { ConnectionUnavailable, LiveSubscriptionFailed } from "../errors";
import { internalQuery } from "../internal/internal-query";
import type { LiveHandler, LivePayload, LiveResource, LiveResult } from "../types";
import type { Uuid } from "../value";
import { BoundQuery } from "./bound-query";
import type { Publisher } from "./publisher";
import { surql } from "./tagged-template";

type ErrorPublisher = Publisher<{
    error: [Error];
}>;

/**
 * Represents a subscription to a LIVE SELECT query
 */
export abstract class LiveSubscription {
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
     * Subscribe to live updates and invoke the handler when an update is received
     *
     * @param handler The handler to invoke when an update is received
     * @returns A function to unsubscribe from the live updates
     */
    abstract subscribe(handler: LiveHandler): () => void;

    /**
     * Kill the live subscription and stop receiving updates
     */
    abstract kill(): Promise<void>;

    /**
     * Iterate over the live subscription using an async iterator
     */
    iterate<Result extends LiveResult = Record<string, unknown>>(): AsyncIterator<
        LivePayload<Result>
    > {
        const queue: LivePayload<Result>[] = [];
        const waiters: (() => void)[] = [];

        const close = this.subscribe((...args) => {
            if (args[0] === "CLOSED" && this.isAlive) return;

            queue.push(args as LivePayload<Result>);
            const waiter = waiters.shift();
            if (waiter) waiter();
        });

        async function poll(): Promise<LivePayload<Result>> {
            let value = queue.shift();
            if (value) return value;

            const { promise, resolve } = Promise.withResolvers();
            waiters.push(resolve);
            await promise;

            value = queue.shift();
            if (!value) throw new Error("A notification was promised, but none was received");
            return value;
        }

        return {
            next: async (): Promise<IteratorResult<LivePayload<Result>>> => {
                const value = await poll();
                return {
                    value,
                    done: value[0] === "CLOSED",
                };
            },

            return: async () => {
                close();
                while (waiters.length) waiters.shift()?.(); // clean up
                return { done: true, value: undefined };
            },
        };
    }

    [Symbol.asyncIterator]<Result extends LiveResult = Record<string, unknown>>(): AsyncIterator<
        LivePayload<Result>
    > {
        return this.iterate<Result>();
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
    #diff: boolean;
    #killed = false;
    #cleanup: (() => void) | undefined;
    #publisher: ErrorPublisher;
    #reconnector: () => void;
    #listeners: Set<LiveHandler> = new Set();

    constructor(
        publisher: ErrorPublisher,
        controller: ConnectionController,
        resource: LiveResource,
        diff: boolean,
    ) {
        super();
        this.#publisher = publisher;
        this.#controller = controller;
        this.#resource = resource;
        this.#diff = diff;

        this.#reconnector = this.#controller.subscribe("connected", () => {
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

    public subscribe(handler: LiveHandler): () => void {
        this.#listeners.add(handler);

        return () => {
            this.#listeners.delete(handler);
        };
    }

    public kill(): Promise<void> {
        this.#killed = true;

        for (const listener of this.#listeners) {
            listener("CLOSED", "KILLED");
        }

        this.#listeners.clear();
        this.#cleanup?.();
        this.#reconnector();

        return internalQuery(this.#controller, surql`KILL $id`);
    }

    #build(): BoundQuery {
        const query = new BoundQuery("LIVE SELECT");

        if (this.#diff) {
            query.append(" DIFF");
        } else {
            query.append(" *");
        }

        query.append(surql`FROM ${this.#resource}`);

        return query;
    }

    async #listen(): Promise<void> {
        this.#cleanup?.();

        try {
            const [id] = await internalQuery<[Uuid]>(this.#controller, this.#build());

            this.#currentId = id;
            this.#cleanup = this.#controller.liveSubscribe(id, (...args) => {
                for (const listener of this.#listeners) {
                    listener(...args);
                }
            });

            this.#controller.subscribe("disconnected", () => {
                for (const listener of this.#listeners) {
                    listener("CLOSED", "DISCONNECTED");
                }
            });
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
    #cleanup: () => void;
    #listeners: Set<LiveHandler> = new Set();

    constructor(controller: ConnectionController, id: Uuid) {
        super();
        this.#controller = controller;
        this.#id = id;

        if (this.#controller.status !== "connected") {
            throw new ConnectionUnavailable();
        }

        this.#cleanup = this.#controller.liveSubscribe(id, (...args) => {
            for (const listener of this.#listeners) {
                listener(...args);
            }
        });

        this.#controller.subscribe("disconnected", () => {
            for (const listener of this.#listeners) {
                listener("CLOSED", "DISCONNECTED");
            }
        });
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

    public subscribe(handler: LiveHandler): () => void {
        this.#listeners.add(handler);

        return () => {
            this.#listeners.delete(handler);
        };
    }

    public kill(): Promise<void> {
        this.#killed = true;
        for (const listener of this.#listeners) {
            listener("CLOSED", "KILLED");
        }

        this.#listeners.clear();
        this.#cleanup();

        return internalQuery(this.#controller, surql`KILL $id`);
    }
}
