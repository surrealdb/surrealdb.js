import {Surreal, Table} from "./packages/sdk/dist/surrealdb";
import { createWasmEngines } from "./packages/wasm/dist/surrealdb-wasm";

const surreal = new Surreal({
    engines: createWasmEngines(),
});

await surreal.connect("mem://");

await surreal.use({
    namespace: "test",
    database: "test",
});

console.log(await surreal.create(new Table("foo")));