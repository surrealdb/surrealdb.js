import type { ConnectionController } from "../controller";
import { DispatchedPromise } from "../internal/dispatched-promise";
import type { Expr, ExprLike, LiveResource, Session } from "../types";
import type { Field, Selection } from "../types/internal";
import { type BoundQuery, surql } from "../utils";
import { LIVE_QUERIES_FEATURE } from "../utils/features";
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
    session: Session;
}

/**
 * A promise representing a managed `live` RPC call to the server.
 */
export class ManagedLivePromise<T> extends DispatchedPromise<LiveSubscription> {
    #connection: ConnectionController;
    #options: ManagedLiveOptions;

    constructor(connection: ConnectionController, options: ManagedLiveOptions) {
        super();
        this.#connection = connection;
        this.#options = options;
    }

    /**
     * Configure the live subscription to return only patches (diffs)
     * instead of the full resource on each update.
     */
    diff(): ManagedLivePromise<T> {
        return new ManagedLivePromise(this.#connection, {
            ...this.#options,
            fields: [],
            selection: "diff",
        });
    }

    /**
     * Configure the query to only select the specified field(s)
     */
    fields(...fields: Field<T>[]): ManagedLivePromise<T> {
        return new ManagedLivePromise(this.#connection, {
            ...this.#options,
            fields: fields as string[],
            selection: "fields",
        });
    }

    /**
     * Configure the query to retrieve the value of the specified field
     */
    value(field: Field<T>): ManagedLivePromise<T> {
        return new ManagedLivePromise(this.#connection, {
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
        return new ManagedLivePromise(this.#connection, {
            ...this.#options,
            cond: expr ? expr : undefined,
        });
    }

    /**
     * Configure the query to fetch record link contents for the specified field(s)
     */
    fetch(...fields: Field<T>[]): ManagedLivePromise<T> {
        return new ManagedLivePromise(this.#connection, {
            ...this.#options,
            fetch: fields as string[],
        });
    }

    /**
     * Compile this qurery into a BoundQuery
     */
    compile(): BoundQuery<[T]> {
        return this.#build().inner;
    }

    protected async dispatch(): Promise<LiveSubscription> {
        await this.#connection.ready();

        this.#connection.assertFeature(LIVE_QUERIES_FEATURE);

        return new ManagedLiveSubscription(
            this.#connection,
            this.#options.what,
            this.#options.session,
            this.#build(),
        );
    }

    #build(): Query {
        const { what, selection, fields, cond, fetch, session } = this.#options;

        const query = surql`LIVE SELECT`;

        if (selection === "fields") {
            query.append(surql` type::fields(${fields})`);
        } else if (selection === "value") {
            query.append(surql` VALUE type::field(${fields?.[0]})`);
        } else if (selection === "diff") {
            query.append(surql` DIFF`);
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
            session,
        });
    }
}

interface UnmanagedLiveOptions {
    id: Uuid;
    session: Session;
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

        this.#connection.assertFeature(LIVE_QUERIES_FEATURE);

        return new UnmanagedLiveSubscription(
            this.#connection,
            this.#options.session,
            this.#options.id,
        );
    }
}
