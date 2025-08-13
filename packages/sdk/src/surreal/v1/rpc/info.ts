import { collect } from "../../../internal/collect";
import { ConnectionPromise } from "../../../internal/promise";
import type { Jsonify } from "../../../utils";

/**
 * A promise representing an `info` RPC call to the server.
 */
export class InfoPromise<T> extends ConnectionPromise<T> {
    #json = false;

    /**
     * Convert the response to a JSON compatible format, ensuring that
     * the response is serializable as a valid JSON structure.
     */
    jsonify(): InfoPromise<Jsonify<T>> {
        this.#json = true;
        return this as InfoPromise<Jsonify<T>>;
    }

    protected async dispatch(): Promise<T> {
        const result = await this.rpc<T>("info");

        return collect<T>(result, {
            json: this.#json,
        });
    }
}
