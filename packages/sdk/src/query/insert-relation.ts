import type { ConnectionController } from "../controller";
import { collect } from "../internal/collect";
import { ConnectionPromise } from "../internal/promise";
import type { Doc } from "../types";
import type { Jsonify } from "../utils";
import type { Table } from "../value";

/**
 * A promise representing an `insert_relation` RPC call to the server.
 */
export class InsertRelationPromise<T, U extends Doc> extends ConnectionPromise<T> {
    #arg1: Table | U | U[];
    #arg2?: U | U[];
    #json = false;

    constructor(connection: ConnectionController, arg1: Table | U | U[], arg2?: U | U[]) {
        super(connection);
        this.#arg1 = arg1;
        this.#arg2 = arg2;
    }

    /**
     * Convert the response to a JSON compatible format, ensuring that
     * the response is serializable as a valid JSON structure.
     */
    jsonify(): InsertRelationPromise<Jsonify<T>, U> {
        this.#json = true;
        return this as InsertRelationPromise<Jsonify<T>, U>;
    }

    protected async dispatch(): Promise<T> {
        const params =
            this.#arg1 instanceof Object && "name" in this.#arg1
                ? [this.#arg1, this.#arg2]
                : [undefined, this.#arg1];

        const result = await this.rpc("insert_relation", params);

        return collect<T>(result, {
            json: this.#json,
        });
    }
}
