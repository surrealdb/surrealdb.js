import { ConnectionPromise } from "../../../internal/promise";

/**
 * A promise representing an `invalidate` RPC call to the server.
 */
export class InvalidatePromise extends ConnectionPromise<true> {
    protected async dispatch(): Promise<true> {
        await this.rpc("invalidate");
        return true;
    }
}
