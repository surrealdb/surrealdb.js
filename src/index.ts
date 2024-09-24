export { Emitter, type Listener, type UnknownEvents } from "./util/emitter.ts";
export { surql, surrealql } from "./util/taggedTemplate.ts";
export { PreparedQuery } from "./util/preparedQuery.ts";

export * as cbor from "./cbor";
export * from "./cbor/gap";
export * from "./cbor/error";
export * from "./data";
export * from "./errors.ts";
export * from "./types.ts";
export * from "./util/jsonify.ts";
export * from "./util/versionCheck.ts";
export * from "./util/getIncrementalID.ts";
export * from "./util/stringPrefixes.ts";
export * from "./util/toSurrealqlString.ts";

export {
	ConnectionStatus,
	AbstractEngine,
	type Engine,
	type Engines,
	type EngineEvents,
} from "./engines/abstract.ts";

export { Surreal, Surreal as default } from "./surreal.ts";
