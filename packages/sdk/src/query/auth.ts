import type { Uuid } from "@surrealdb/sqon";
import type { ConnectionController } from "../controller";
import { assertCredential } from "../internal/auth-provider";
import { DispatchedPromise } from "../internal/dispatched-promise";
import type { MaybeJsonify } from "../internal/maybe-jsonify";
import type { AuthOrToken, Session } from "../types";
import { BoundQuery } from "../utils";
import type { Frame } from "../utils/frame";
import { Query } from "./query";

interface AuthOptions {
    transaction: Uuid | undefined;
    session: Session;
    credential?: AuthOrToken;
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
     * Run this call as a different identity than the one of the session, for this call only.
     * The session is neither used nor changed. Supported by engines which present credentials
     * with every request, such as HTTP, and rejected with an `UnsupportedFeatureError` by
     * the others.
     *
     * @see {@link Query.as} for details.
     *
     * @param credential An access token or authentication details to run this call as
     * @returns A new `AuthPromise` which runs as the provided identity.
     */
    as(credential: AuthOrToken): AuthPromise<T, J> {
        assertCredential(credential);

        return new AuthPromise<T, J>(this.#connection, {
            ...this.#options,
            credential,
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
        const { transaction, session, json } = this.#options;

        return new Query(this.#connection, {
            credential: this.#options.credential,
            query: new BoundQuery("SELECT * FROM ONLY $auth"),
            transaction,
            session,
            json,
        });
    }
}
