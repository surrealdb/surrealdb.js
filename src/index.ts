import { UnexpectedStrategy } from "./errors.ts";
import { WebSocketStrategy } from "./strategies/websocket.ts";
import { ConnectionStrategy } from "./types.ts";
export * from "./types.ts";

export class Surreal {
	constructor(
		url: string,
		prepare: () => unknown,
		strategy: ConnectionStrategy = "websocket"
	) {
		switch (strategy) {
			case "websocket":
				return new WebSocketStrategy(url, prepare);
			default:
				throw new UnexpectedStrategy();
		}
	}
}

export { WebSocketStrategy as SurrealWebSocket };

export default Surreal;
