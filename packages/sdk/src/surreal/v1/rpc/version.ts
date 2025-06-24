import { ConnectionPromise } from "../../../internal/promise";

/**
 * A promise representing a `version` RPC call to the server.
 */
export class VersionPromise extends ConnectionPromise<string> {
	protected async dispatch(): Promise<string> {
		return await this.rpc("version");
	}
}
