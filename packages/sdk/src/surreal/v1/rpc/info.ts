import { ConnectionPromise } from "../../../internal/promise";
import type { ActionResult, Doc } from "../../../types";

/**
 * A promise representing an `info` RPC call to the server.
 */
export class InfoPromise<T extends Doc> extends ConnectionPromise<
	ActionResult<T> | undefined
> {
	protected async dispatch(): Promise<ActionResult<T> | undefined> {
		return await this.rpc<ActionResult<T> | undefined>("info");
	}
}
