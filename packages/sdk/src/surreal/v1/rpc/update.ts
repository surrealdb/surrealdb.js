import type { ConnectionController } from "../../../controller";
import { collect } from "../../../internal/collect";
import { ConnectionPromise } from "../../../internal/promise";
import type { Doc } from "../../../types";
import type { Jsonify } from "../../../utils";
import type { RecordId, RecordIdRange, Table } from "../../../value";

/**
 * A promise representing an `update` RPC call to the server.
 */
export class UpdatePromise<T, U extends Doc> extends ConnectionPromise<T> {
    #thing: RecordId | RecordIdRange | Table;
    #data?: U;
    #json = false;

    constructor(
        connection: ConnectionController,
        thing: RecordId | RecordIdRange | Table,
        data?: U,
    ) {
        super(connection);
        this.#thing = thing;
        this.#data = data;
    }

    /**
     * Convert the response to a JSON compatible format, ensuring that
     * the response is serializable as a valid JSON structure.
     */
    jsonify(): UpdatePromise<Jsonify<T>, U> {
        this.#json = true;
        return this as UpdatePromise<Jsonify<T>, U>;
    }

    protected async dispatch(): Promise<T> {
        const result = await this.rpc("update", [this.#thing, this.#data]);

        return collect<T>(result, {
            subject: this.#thing,
            json: this.#json,
        });
    }
}
