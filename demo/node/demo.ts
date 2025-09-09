import { createNodeEngines } from "@surrealdb/node";
import { Surreal } from "surrealdb";

const surreal = new Surreal({
    engines: createNodeEngines(),
});

await surreal.connect("surrealkv+versioned://test.db");

await surreal.use({
    namespace: "test",
    database: "test",
});

const res = await surreal.query("RETURN false").collect();

console.log(res);
