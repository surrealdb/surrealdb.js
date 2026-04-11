import {
    Surreal,
    RecordId,
    Table,
    StringRecordId,
    RecordIdRange,
    BoundIncluded,
    BoundExcluded,
    Uuid,
    DateTime,
    Decimal,
    Duration,
    HttpEngine,
    WebSocketEngine,
} from "surrealdb";

// Instantiation
const db = new Surreal();

// Connection
async function main() {
    await db.connect("ws://localhost:8000");
    await db.use({ namespace: "test", database: "test" });
    await db.signin({ username: "root", password: "root" });

    // Record IDs
    const stringId = new RecordId("person", "tobie");
    const numberId = new RecordId("person", 123);
    const uuidId = new RecordId("person", new Uuid("d2f72714-a387-487a-8eae-451330796ff4"));

    // Tables
    const table = new Table("person");

    // String record IDs
    const strId = new StringRecordId("person:tobie");

    // Record ID ranges
    const range = new RecordIdRange("person", new BoundIncluded("a"), new BoundExcluded("z"));

    // Values
    const dt = new DateTime(new Date());
    const dec = new Decimal("3.14");
    const dur = new Duration("1h30m");

    // CRUD
    interface Person {
        name: string;
        age: number;
    }

    const created = await db.create<Person>(table, { name: "Tobie", age: 30 });
    const selected = await db.select<Person>(table);
    const updated = await db.update<Person>(stringId).merge({ age: 31 });
    const deleted = await db.delete(stringId);

    // Queries
    const [result] = await db
        .query("SELECT * FROM $table WHERE age > $age", { table, age: 25 })
        .collect<[Person[]]>();

    // Live queries
    const stream = await db.live(table);
    for await (const { action, value } of stream) {
        if (action === "CREATE") {
            console.log(value);
        }
    }
}
