import { ConnectionFuture } from "packages/sdk/src/internal/future";

export class PingFuture extends ConnectionFuture<true> {
	async dispatch(): Promise<true> {
		await this.rpc<true>("ping");
		return true;
	}
}
