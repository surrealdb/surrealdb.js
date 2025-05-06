import type { DriverOptions } from "../types";
import { SurrealV2 } from "./v2";

export * from "./v1";
export * from "./v2";

/**
 * The Surreal class serves as the main entry point for interacting with a Surreal database.
 *
 * By default the Surreal class supports endpoints with the `http`, `https`,
 * `ws`, and `wss` protocols. The constructor accepts an options object that can be used to configure additional engines,
 * such as those provided by the `@surrealdb/wasm` package.
 *
 * Compatible with the SurrealDB RPC v2 protocol
 */
export class Surreal extends SurrealV2 {
	constructor(options: DriverOptions = {}) {
		super(options);
	}
}
