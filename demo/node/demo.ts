import { Surreal } from "surrealdb";
import { createNodeEngines } from "../../packages/node/src-ts";

const surreal = new Surreal({
    engines: createNodeEngines(),
});

await surreal.connect("mem://");

await surreal.use({
    namespace: "test",
    database: "test",
});

const res = await surreal.query("RETURN false").collect();

console.log(res);
