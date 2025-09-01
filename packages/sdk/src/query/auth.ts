import type { ConnectionController } from "../controller";
import { DispatchedPromise } from "../internal/dispatched-promise";
import type { MaybeJsonify } from "../internal/maybe-jsonify";
import { BoundQuery } from "../utils";
import type { Frame } from "../utils/frame";
import type { Uuid } from "../value";
import { Query } from "./query";

interface AuthOptions {
    transaction: Uuid | undefined;
    json: boolean;
}

/**
 * A configurable `Promise` for retrieving auth information from a SurrealDB instance.
 */
export class AuthPromise<T, J extends boolean = false> extends DispatchedPromise<
    MaybeJsonify<T, J>
> {
    #connection: ConnectionController;
    #options: AuthOptions;

    constructor(connection: ConnectionController, options: AuthOptions) {
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
    json(): AuthPromise<T, true> {
        return new AuthPromise(this.#connection, {
            ...this.#options,
            json: true,
        });
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
        return result as MaybeJsonify<T, J>;
    }

    #build(): Query<J> {
        const { transaction, json } = this.#options;

        return new Query(this.#connection, {
            query: new BoundQuery("SELECT * FROM ONLY $auth"),
            transaction,
            json,
        });
    }
}
