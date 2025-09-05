import { WebAssemblyEngine } from "@surrealdb/wasm";

console.log("WASM Demo");

const engine = new WebAssemblyEngine({} as any);

console.log(engine.open({} as any));
