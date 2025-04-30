import { SurrealV2 } from "./v2";

export * from "./v1";
export * from "./v2";

/**
 * The Surreal class provides the entrypoint for connecting to and interacting with
 * any SurrealDB instance.
 *
 * This class implements the v2 RPC protocol.
 */
const Surreal: SurrealV2 = SurrealV2;

export { Surreal };
