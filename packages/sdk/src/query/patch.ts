import type { ConnectionController } from "../controller";
import { collect } from "../internal/collect";
import { ConnectionPromise } from "../internal/promise";
import type { Patch } from "../types";
import type { Jsonify } from "../utils";
import type { RecordId, RecordIdRange, Table } from "../value";

/**
 * A promise representing a `patch` RPC call to the server.
 */
export class PatchPromise<T> extends ConnectionPromise<T> {
    #what: RecordId | RecordIdRange | Table;
    #data?: Patch[];
    #diff?: boolean;
    #json = false;

    constructor(
        connection: ConnectionController,
        what: RecordId | RecordIdRange | Table,
        data?: Patch[],
        diff?: boolean,
    ) {
        super(connection);
        this.#what = what;
        this.#data = data;
        this.#diff = diff;
    }

    /**
     * Convert the response to a JSON compatible format, ensuring that
     * the response is serializable as a valid JSON structure.
     */
    jsonify(): PatchPromise<Jsonify<T>> {
        this.#json = true;
        return this as PatchPromise<Jsonify<T>>;
    }

    protected async dispatch(): Promise<T> {
        const result = await this.rpc("patch", [this.#what, this.#data, this.#diff]);

        if (this.#diff) {
            return result as T;
        }

        return collect<T>(result, {
            subject: this.#what,
            json: this.#json,
        });
    }
}
