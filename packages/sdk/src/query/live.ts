import type { SurrealV1Events } from "../../dist/surrealdb";
import type { ConnectionController } from "../controller";
import { DispatchedPromise } from "../internal/promise";
import type { LiveResource } from "../types";
import type { Publisher } from "../utils";
import {
    type LiveSubscription,
    ManagedLiveSubscription,
    UnmanagedLiveSubscription,
} from "../utils/live";
import type { Uuid } from "../value";

/**
 * A promise representing a managed `live` RPC call to the server.
 */
export class ManagedLivePromise extends DispatchedPromise<LiveSubscription> {
    #connection: ConnectionController;
    #publisher: Publisher<SurrealV1Events>;
    #what: LiveResource;
    #diff = false;

    constructor(
        connection: ConnectionController,
        publisher: Publisher<SurrealV1Events>,
        what: LiveResource,
    ) {
        super();
        this.#connection = connection;
        this.#publisher = publisher;
        this.#what = what;
    }

    /**
     * Configure the live subscription to return only patches (diffs)
     * instead of the full resource on each update.
     */
    diff(): this {
        this.#diff = true;
        return this;
    }

    protected async dispatch(): Promise<LiveSubscription> {
        await this.#connection.ready();

        return new ManagedLiveSubscription(
            this.#publisher,
            this.#connection,
            this.#what,
            this.#diff,
        );
    }
}

/**
 * A promise representing an unmanaged `live` RPC call to the server.
 */
export class UnmanagedLivePromise extends DispatchedPromise<LiveSubscription> {
    #connection: ConnectionController;
    #id: Uuid;

    constructor(connection: ConnectionController, id: Uuid) {
        super();
        this.#connection = connection;
        this.#id = id;
    }

    protected async dispatch(): Promise<LiveSubscription> {
        await this.#connection.ready();

        return new UnmanagedLiveSubscription(this.#connection, this.#id);
    }
}
