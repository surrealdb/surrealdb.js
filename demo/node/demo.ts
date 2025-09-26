import { createNodeEngines } from "@surrealdb/node";
import { RecordId, Surreal, Table } from "surrealdb";

const surreal = new Surreal({
    engines: createNodeEngines(),
});

await surreal.connect("surrealkv+versioned://test.db");

await surreal.use({
    namespace: "test",
    database: "test",
});

const live = await surreal.live(new Table("test"));

live.subscribe((message) => {
    console.log("Live notification:", message);
});

const res = await surreal.upsert(new RecordId("test", 1)).content({
    name: "John",
    value: Math.random(),
});

console.log("Result =", res);

await Bun.sleep(1000);
await surreal.close();
