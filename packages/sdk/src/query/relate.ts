import type { ConnectionController } from "../controller";
import { collect } from "../internal/collect";
import { ConnectionPromise } from "../internal/promise";
import type { Doc, RelateInOut } from "../types";
import type { Jsonify } from "../utils";
import type { RecordId, Table } from "../value";

/**
 * A promise representing a `relate` RPC call to the server.
 */
export class RelatePromise<T, U extends Doc> extends ConnectionPromise<T> {
    #from: RelateInOut;
    #what: Table | RecordId;
    #to: RelateInOut;
    #data?: U;
    #json = false;

    constructor(
        connection: ConnectionController,
        from: RelateInOut,
        what: Table | RecordId,
        to: RelateInOut,
        data?: U,
    ) {
        super(connection);
        this.#from = from;
        this.#what = what;
        this.#to = to;
        this.#data = data;
    }

    /**
     * Convert the response to a JSON compatible format, ensuring that
     * the response is serializable as a valid JSON structure.
     */
    jsonify(): RelatePromise<Jsonify<T>, U> {
        this.#json = true;
        return this as RelatePromise<Jsonify<T>, U>;
    }

    protected async dispatch(): Promise<T> {
        const result = await this.rpc("relate", [this.#from, this.#what, this.#to, this.#data]);

        return collect<T>(result, {
            subject: this.#what,
            json: this.#json,
        });
    }
}
