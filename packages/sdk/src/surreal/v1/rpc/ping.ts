import { ConnectionPromise } from "../../../internal/promise";

/**
 * A promise representing a `ping` RPC call to the server.
 */
export class PingPromise extends ConnectionPromise<true> {
    protected async dispatch(): Promise<true> {
        await this.rpc<true>("ping");
        return true;
    }
}
