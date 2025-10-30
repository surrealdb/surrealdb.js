import type { ConnectionController } from "../controller";
import { SurrealError } from "../errors";
import { DispatchedPromise } from "../internal/dispatched-promise";
import type { MaybeJsonify } from "../internal/maybe-jsonify";
import type { Session } from "../types";
import { BoundQuery, surql } from "../utils";
import type { Frame } from "../utils/frame";
import type { Uuid } from "../value";
import { Query } from "./query";

const NAME_REGEX = /^[a-zA-Z0-9_:]+$/;
const VERSION_REGEX = /^[0-9.]+$/;

interface RunOptions {
    name: string;
    version: string | undefined;
    args: unknown[];
    transaction: Uuid | undefined;
    session: Session;
    json: boolean;
}

/**
 * A configurable `Promise` for a run query sent to a SurrealDB instance.
 */
export class RunPromise<T, J extends boolean = false> extends DispatchedPromise<
    MaybeJsonify<T, J>
> {
    #connection: ConnectionController;
    #options: RunOptions;

    constructor(connection: ConnectionController, options: RunOptions) {
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
    json(): RunPromise<T, true> {
        return new RunPromise<T, true>(this.#connection, {
            ...this.#options,
            json: true,
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
        const { name, version, args, transaction, session, json } = this.#options;

        if (!NAME_REGEX.test(name)) {
            throw new SurrealError("Invalid function name");
        }

        const query = new BoundQuery(name);

        if (version) {
            if (!VERSION_REGEX.test(version)) {
                throw new SurrealError("Invalid function version");
            }

            query.append(`<${version}>`);
        }

        query.append("(");

        for (const arg of args) {
            query.append(surql`${arg}, `);
        }

        query.append(")");

        return new Query(this.#connection, {
            query,
            transaction,
            json,
            session,
        });
    }
}
