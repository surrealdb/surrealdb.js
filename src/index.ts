export { Emitter, type Listener, type UnknownEvents } from "./util/emitter.ts";
export { surql, surrealql } from "./util/tagged-template.ts";
export { PreparedQuery } from "./util/prepared-query.ts";
export * as cbor from "./cbor";
export * from "./cbor/gap";
export * from "./cbor/error";
export * from "./data";
export * from "./errors.ts";
export * from "./types.ts";
export * from "./util/equals.ts";
export * from "./util/jsonify.ts";
export * from "./util/version-check.ts";
export * from "./util/get-incremental-id.ts";
export * from "./util/string-prefixes.ts";
export * from "./util/to-surrealql-string.ts";
export {
	ConnectionStatus,
	AbstractEngine,
	type Engine,
	type Engines,
	type EngineEvents,
} from "./engines/abstract.ts";
export { Surreal, Surreal as default } from "./surreal.ts";
