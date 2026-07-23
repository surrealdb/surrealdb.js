import type { Uuid } from "@surrealdb/sqon";
import type { ConnectionController } from "../controller";
import { abortScope, raceAbort, throwIfAborted } from "../internal/abort";
import { DispatchedPromise } from "../internal/dispatched-promise";
import type { Expr, ExprLike, LiveResource, Session } from "../types";
import type { Field, Selection } from "../types/internal";
import { type BoundQuery, Features, surql } from "../utils";
import {
    type LiveSubscription,
    ManagedLiveSubscription,
    UnmanagedLiveSubscription,
} from "../utils/live";
import { Query } from "./query";

interface ManagedLiveOptions {
    what: LiveResource;
    fields?: string[];
    selection?: Selection;
    cond?: Expr;
    fetch?: string[];
    session: Session;
    /** Kill the subscription when any of these abort, which a request scope sets */
    signals?: readonly AbortSignal[];
}

/**
 * A promise representing a managed `live` RPC call to the server.
 */
export class ManagedLivePromise<T> extends DispatchedPromise<LiveSubscription<T>> {
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

    protected async dispatch(): Promise<LiveSubscription<T>> {
        const abort = abortScope(this.#options.signals ?? []);
        let subscription: ManagedLiveSubscription<T> | undefined;

        try {
            // A signal which has aborted already means no live query is registered at all
            throwIfAborted(abort.signal);
            await raceAbort(this.#connection.ready(), abort.signal);

            this.#connection.assertFeature(Features.LiveQueries);
            throwIfAborted(abort.signal);

            // From here the subscription owns the signals, and kills itself when they abort
            subscription = new ManagedLiveSubscription<T>(
                this.#connection,
                this.#options.what,
                this.#options.session,
                this.#build(abort.signal),
                abort.signal ? abort : undefined,
            );

            // Await the LIVE round-trip so the query is registered on the server and
            // this client is subscribed before the caller can issue any writes. If the signal
            // aborts first the caller is told so at once, and the subscription, which has been
            // killed, ends the live query the server registers in the meantime.
            await raceAbort(subscription.ready(), abort.signal);

            return subscription;
        } catch (error) {
            if (subscription && abort.signal) {
                // Not handed over, so nothing else will end it or let go of its signals
                await subscription.kill().catch(() => {});
            } else {
                abort.dispose();
            }

            throw error;
        }
    }

    /**
     * @param beforeSend A signal which abandons the registration while it waits to be sent, which
     *                   is while the credential for it is settled, but not once it is on its way: what
     *                   the server registers is then to be killed, and only the answer says what it is.
     */
    #build(beforeSend?: AbortSignal): Query {
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
            beforeSend,
        });
    }
}

interface UnmanagedLiveOptions {
    id: Uuid;
    session: Session;
    /** Kill the subscription when any of these abort, which a request scope sets */
    signals?: readonly AbortSignal[];
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
        const abort = abortScope(this.#options.signals ?? []);

        try {
            // A signal which has aborted already means nothing is subscribed to
            throwIfAborted(abort.signal);
            await raceAbort(this.#connection.ready(), abort.signal);

            this.#connection.assertFeature(Features.LiveQueries);
            throwIfAborted(abort.signal);

            // From here the subscription owns the signals, and kills itself when they abort
            return new UnmanagedLiveSubscription(
                this.#connection,
                this.#options.session,
                this.#options.id,
                abort.signal ? abort : undefined,
            );
        } catch (error) {
            abort.dispose();
            throw error;
        }
    }
}
