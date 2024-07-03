export { Emitter, type Listener, type UnknownEvents } from "./util/emitter.ts";
export { surql, surrealql } from "./util/tagged-template.ts";
export { PreparedQuery } from "./util/PreparedQuery.ts";
export * as cbor from "./cbor";
export * from "./cbor/gap";
export * from "./cbor/error";
export * from "./data";
export * from "./errors.ts";
export * from "./types.ts";
export * from "./util/jsonify.ts";
export * from "./util/versionCheck.ts";
export {
	ConnectionStatus,
	AbstractEngine,
	type Engine,
	type EngineEvents,
} from "./engines/abstract.ts";
export { Surreal, Surreal as default } from "./surreal.ts";
