import type { ConnectionController } from "../controller";
import { DispatchedPromise } from "../internal/dispatched-promise";
import { _only, _output, _timeout } from "../internal/internal-expressions";
import type { MaybeJsonify } from "../internal/maybe-jsonify";
import type { AnyRecordId, Expr, ExprLike, Mutation, Output, Session, Values } from "../types";
import { type BoundQuery, raw, surql } from "../utils";
import type { Frame } from "../utils/frame";
import type { Duration, RecordIdRange, Table, Uuid } from "../value";
import { Query } from "./query";

interface UpsertOptions {
    what: AnyRecordId | RecordIdRange | Table;
    mutation?: Mutation;
    data?: unknown;
    cond?: Expr;
    output?: Output;
    timeout?: Duration;
    transaction: Uuid | undefined;
    session: Session;
    json: boolean;
}

/**
 * A configurable `Promise` for an upsert query sent to a SurrealDB instance.
 */
export class UpsertPromise<T, I, J extends boolean = false> extends DispatchedPromise<
    MaybeJsonify<T, J>
> {
    #connection: ConnectionController;
    #options: UpsertOptions;

    constructor(connection: ConnectionController, options: UpsertOptions) {
        super();
        this.#connection = connection;
        this.#options = options;
    }

    /**
     * Configure the query to return the result as a
     * JSON-compatible structure.
     *
     * This is useful when query results need to be serialized. Keep in mind
     * that your responses will lose SurrealDB type information.
     */
    json(): UpsertPromise<T, I, true> {
        return new UpsertPromise<T, I, true>(this.#connection, {
            ...this.#options,
            json: true,
        });
    }

    /**
     * Configure the query to set the record data
     */
    content(data: Values<I>): UpsertPromise<T, I, J> {
        return new UpsertPromise<T, I, J>(this.#connection, {
            ...this.#options,
            mutation: "content",
            data,
        });
    }

    /**
     * Configure the query to merge the record data
     */
    merge(data: Values<I>): UpsertPromise<T, I, J> {
        return new UpsertPromise<T, I, J>(this.#connection, {
            ...this.#options,
            mutation: "merge",
            data,
        });
    }

    /**
     * Configure the query to replace the record data
     */
    replace(data: Values<I>): UpsertPromise<T, I, J> {
        return new UpsertPromise<T, I, J>(this.#connection, {
            ...this.#options,
            mutation: "replace",
            data,
        });
    }

    /**
     * Configure the query to patch the record data
     */
    patch(data: Values<I>): UpsertPromise<T, I, J> {
        return new UpsertPromise<T, I, J>(this.#connection, {
            ...this.#options,
            mutation: "patch",
            data,
        });
    }

    /**
     * Configure the query to upsert the record only if the condition is met.
     *
     * Expressions can be imported from the `surrealdb` package and combined
     * to compose the desired condition.
     *
     * @see {@link https://github.com/surrealdb/surrealdb.js/blob/main/packages/sdk/src/utils/expr.ts}
     */
    where(expr: ExprLike): UpsertPromise<T, I, J> {
        return new UpsertPromise<T, I, J>(this.#connection, {
            ...this.#options,
            cond: expr ? expr : undefined,
        });
    }

    /**
     * Configure the output of the query
     */
    output(output: Output): UpsertPromise<T, I, J> {
        return new UpsertPromise<T, I, J>(this.#connection, {
            ...this.#options,
            output,
        });
    }

    /**
     * Configure the timeout of the query
     */
    timeout(timeout: Duration): UpsertPromise<T, I, J> {
        return new UpsertPromise<T, I, J>(this.#connection, {
            ...this.#options,
            timeout,
        });
    }

    /**
     * Compile this qurery into a BoundQuery
     */
    compile(): BoundQuery<[T]> {
        return this.#build().inner;
    }

    /**
     * Stream the results of the query as they are received.
     *
     * @returns An async iterable of query frames.
     */
    async *stream(): AsyncIterable<Frame<T, J>> {
        await this.#connection.ready();
        const query = this.#build().stream<T>();

        for await (const frame of query) {
            yield frame;
        }
    }

    protected async dispatch(): Promise<MaybeJsonify<T, J>> {
        await this.#connection.ready();
        const [result] = await this.#build().collect();
        return result;
    }

    #build(): Query<[T], J> {
        const { what, data, transaction, session, json, cond, output, timeout, mutation } =
            this.#options;

        const query = surql`UPSERT ${_only(what)}`;

        if (mutation && data) {
            query.append(surql` ${raw(mutation.toUpperCase())} ${data}`);
        }

        if (cond) {
            query.append(surql` WHERE ${cond}`);
        }

        if (output) {
            query.append(surql` RETURN ${_output(output)}`);
        }

        if (timeout) {
            query.append(surql` TIMEOUT ${_timeout(timeout)}`);
        }

        return new Query(this.#connection, {
            query,
            transaction,
            json,
            session,
        });
    }
}
