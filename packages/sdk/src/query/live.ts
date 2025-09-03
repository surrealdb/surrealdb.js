import type { ConnectionController } from "../controller";
import { DispatchedPromise } from "../internal/dispatched-promise";
import type { SurrealEvents } from "../surreal";
import type { Expr, ExprLike, LiveResource } from "../types";
import type { Field, Selection } from "../types/internal";
import { type BoundQuery, type Publisher, surql } from "../utils";
import {
    type LiveSubscription,
    ManagedLiveSubscription,
    UnmanagedLiveSubscription,
} from "../utils/live";
import type { Uuid } from "../value";
import { Query } from "./query";

interface ManagedLiveOptions {
    what: LiveResource;
    fields?: string[];
    selection?: Selection;
    cond?: Expr;
    fetch?: string[];
}

/**
 * A promise representing a managed `live` RPC call to the server.
 */
export class ManagedLivePromise<T> extends DispatchedPromise<LiveSubscription> {
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
    diff(): ManagedLivePromise<T> {
        return new ManagedLivePromise(this.#connection, this.#publisher, {
            ...this.#options,
            fields: [],
            selection: "diff",
        });
    }

    /**
     * Configure the query to only select the specified field(s)
     */
    fields(...fields: Field<T>[]): ManagedLivePromise<T> {
        return new ManagedLivePromise(this.#connection, this.#publisher, {
            ...this.#options,
            fields: fields as string[],
            selection: "fields",
        });
    }

    /**
     * Configure the query to retrieve the value of the specified field
     */
    value(field: Field<T>): ManagedLivePromise<T> {
        return new ManagedLivePromise(this.#connection, this.#publisher, {
            ...this.#options,
            fields: [field as string],
            selection: "value",
        });
    }

    /**
     * Configure the query to fetch the record only if the condition is met.
     *
     * Expressions can be imported from the `surrealdb` package and combined
     * to compose the desired condition.
     *
     * @see {@link https://github.com/surrealdb/surrealdb.js/blob/main/packages/sdk/src/utils/expr.ts}
     */
    where(expr: ExprLike): ManagedLivePromise<T> {
        return new ManagedLivePromise(this.#connection, this.#publisher, {
            ...this.#options,
            cond: expr ? expr : undefined,
        });
    }

    /**
     * Configure the query to fetch record link contents for the specified field(s)
     */
    fetch(...fields: Field<T>[]): ManagedLivePromise<T> {
        return new ManagedLivePromise(this.#connection, this.#publisher, {
            ...this.#options,
            fetch: fields as string[],
        });
    }

    /**
     * Compile this qurery into a BoundQuery
     */
    compile(): BoundQuery {
        return this.#build().inner;
    }

    protected async dispatch(): Promise<LiveSubscription> {
        await this.#connection.ready();

        return new ManagedLiveSubscription(
            this.#publisher,
            this.#connection,
            this.#options.what,
            this.#build(),
        );
    }

    #build(): Query {
        const { what, selection, fields, cond, fetch } = this.#options;

        const query = surql`LIVE SELECT`;

        if (selection === "fields") {
            query.append(surql` type::fields(${fields})`);
        } else if (selection === "value") {
            query.append(surql` VALUE type::field(${fields?.[0]})`);
        } else {
            query.append(surql` *`);
        }

        query.append(surql` FROM ${what}`);

        if (cond) {
            query.append(surql` WHERE ${cond}`);
        }

        if (fetch) {
            query.append(surql` FETCH type::fields(${fetch})`);
        }

        return new Query(this.#connection, {
            query,
            transaction: undefined,
            json: false,
        });
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
