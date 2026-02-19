import {Surreal, Table} from "./packages/sdk/dist/surrealdb";
import { createWasmEngines } from "./packages/wasm/dist/surrealdb-wasm";

console.log("1. Creating Surreal instance");
const surreal = new Surreal({
    engines: createWasmEngines(),
});

console.log("2. Connecting...");
await surreal.connect("mem://");

console.log("3. Connected! Setting namespace...");
await surreal.use({
    namespace: "test",
    database: "test",
});

console.log("4. Creating record...");
console.log(await surreal.create(new Table("foo")));

console.log("5. Closing...");
await surreal.close();
console.log("6. Done");
