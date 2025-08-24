import type { SurrealEvents } from "../../dist/surrealdb";
import type { ConnectionController } from "../controller";
import { DispatchedPromise } from "../internal/dispatched-promise";
import type { LiveResource } from "../types";
import type { Publisher } from "../utils";
import {
    type LiveSubscription,
    ManagedLiveSubscription,
    UnmanagedLiveSubscription,
} from "../utils/live";
import type { Uuid } from "../value";

interface ManagedLiveOptions {
    what: LiveResource;
    diff: boolean;
}

/**
 * A promise representing a managed `live` RPC call to the server.
 */
export class ManagedLivePromise extends DispatchedPromise<LiveSubscription> {
    #connection: ConnectionController;
    #publisher: Publisher<SurrealEvents>;
    #options: ManagedLiveOptions;

    constructor(
        connection: ConnectionController,
        publisher: Publisher<SurrealEvents>,
        options: ManagedLiveOptions,
    ) {
        super();
        this.#connection = connection;
        this.#publisher = publisher;
        this.#options = options;
    }

    /**
     * Configure the live subscription to return only patches (diffs)
     * instead of the full resource on each update.
     */
    diff(): ManagedLivePromise {
        return new ManagedLivePromise(this.#connection, this.#publisher, {
            ...this.#options,
            diff: true,
        });
    }

    protected async dispatch(): Promise<LiveSubscription> {
        await this.#connection.ready();

        return new ManagedLiveSubscription(
            this.#publisher,
            this.#connection,
            this.#options.what,
            this.#options.diff,
        );
    }
}

interface UnmanagedLiveOptions {
    id: Uuid;
}

/**
 * A promise representing an unmanaged `live` RPC call to the server.
 */
export class UnmanagedLivePromise extends DispatchedPromise<LiveSubscription> {
    #connection: ConnectionController;
    #options: UnmanagedLiveOptions;

    constructor(connection: ConnectionController, options: UnmanagedLiveOptions) {
        super();
        this.#connection = connection;
        this.#options = options;
    }

    protected async dispatch(): Promise<LiveSubscription> {
        await this.#connection.ready();

        return new UnmanagedLiveSubscription(this.#connection, this.#options.id);
    }
}
