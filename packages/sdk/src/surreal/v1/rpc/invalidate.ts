import { ConnectionPromise } from "../../../internal/promise";

export class InvalidatePromise extends ConnectionPromise<true> {
	protected async dispatch(): Promise<true> {
		await this.rpc("invalidate");
		return true;
	}
}
