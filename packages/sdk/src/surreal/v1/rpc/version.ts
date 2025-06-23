import { ConnectionPromise } from "../../../internal/promise";

export class VersionPromise extends ConnectionPromise<string> {
	protected async dispatch(): Promise<string> {
		return await this.rpc("version");
	}
}
