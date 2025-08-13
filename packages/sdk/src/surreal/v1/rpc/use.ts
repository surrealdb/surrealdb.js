import type { ConnectionController } from "../../../controller";
import { SurrealError } from "../../../errors";
import { ConnectionPromise } from "../../../internal/promise";
import type { Nullish } from "../../../types";

/**
 * A promise representing a `use` RPC call to the server.
 */
export class UsePromise extends ConnectionPromise<true> {
    #namespace: Nullish<string>;
    #database: Nullish<string>;

    constructor(
        connection: ConnectionController,
        namespace: Nullish<string>,
        database: Nullish<string>,
    ) {
        super(connection);
        this.#namespace = namespace;
        this.#database = database;
    }

    protected async dispatch(): Promise<true> {
        if (this.#namespace === null && this.#database !== null)
            throw new SurrealError("Cannot unset namespace without unsetting database");

        await this.rpc<true>("use", [this.#namespace, this.#database]);
        return true;
    }
}
