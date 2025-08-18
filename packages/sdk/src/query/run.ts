import type { ConnectionController } from "../controller";
import { SurrealError } from "../errors";
import { DispatchedPromise } from "../internal/dispatched-promise";
import { internalQuery } from "../internal/internal-query";
import type { MaybeJsonify } from "../types/internal";
import { BoundQuery, surql } from "../utils";
import type { Uuid } from "../value";

const NAME_REGEX = /^[a-zA-Z0-9_:]+$/;
const VERSION_REGEX = /^[0-9.]+$/;

/**
 * A configurable `Promise` for a run query sent to a SurrealDB instance.
 */
export class RunPromise<T, J extends boolean = false> extends DispatchedPromise<
    MaybeJsonify<T, J>
> {
    #connection: ConnectionController;
    #name: string;
    #version: string | undefined;
    #args: unknown[];
    #transaction: Uuid | undefined;
    #json: J;

    constructor(
        connection: ConnectionController,
        name: string,
        version: string | undefined,
        args: unknown[],
    ) {
        super();
        this.#connection = connection;
        this.#name = name;
        this.#version = version;
        this.#args = args;
        this.#transaction = undefined;
        this.#json = false as J;
    }

    /**
     * Configure the query to return the result as a
     * JSON-compatible structure.
     *
     * This is useful when query results need to be serialized. Keep in mind
     * that your responses will lose SurrealDB type information.
     */
    json(): RunPromise<T, true> {
        const promise = new RunPromise<T, true>(
            this.#connection,
            this.#name,
            this.#version,
            this.#args,
        );
        promise.#transaction = this.#transaction;
        return promise;
    }

    /**
     * Attach this query to a specific transaction.
     *
     * @param transactionId The ID of the transaction to attach this query to
     */
    txn(transactionId: Uuid): RunPromise<T, J> {
        const promise = new RunPromise<T, J>(
            this.#connection,
            this.#name,
            this.#version,
            this.#args,
        );
        promise.#transaction = transactionId;
        promise.#json = this.#json;
        return promise;
    }

    protected async dispatch(): Promise<MaybeJsonify<T, J>> {
        await this.#connection.ready();

        if (!NAME_REGEX.test(this.#name)) {
            throw new SurrealError("Invalid function name");
        }

        const query = new BoundQuery(this.#name);

        if (this.#version) {
            if (!VERSION_REGEX.test(this.#version)) {
                throw new SurrealError("Invalid function version");
            }

            query.append(`<${this.#version}>`);
        }

        query.append("(");

        for (const arg of this.#args) {
            query.append(surql`${arg}, `);
        }

        query.append(")");

        return internalQuery(this.#connection, surql`${query}`, this.#json, this.#transaction);
    }
}
