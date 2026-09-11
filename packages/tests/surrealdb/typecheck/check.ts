import {
    BoundExcluded,
    BoundIncluded,
    DateTime,
    Decimal,
    Duration,
    RecordId,
    RecordIdRange,
    StringRecordId,
    Surreal,
    Table,
    Uuid,
} from "surrealdb";

interface Person {
    name: string;
    age: number;
}

async function _main() {
    // Instantiation
    const db = new Surreal();

    // Connection
    await db.connect("ws://localhost:8000");
    await db.use({ namespace: "test", database: "test" });
    await db.signin({ username: "root", password: "root" });

    // Record IDs
    const _stringId = new RecordId("person", "tobie");
    const _numberId = new RecordId("person", 123);
    const _uuidId = new RecordId("person", new Uuid("d2f72714-a387-487a-8eae-451330796ff4"));

    // Tables
    const table = new Table("person");

    // String record IDs
    const _strId = new StringRecordId("person:tobie");

    // Record ID ranges
    const _range = new RecordIdRange("person", new BoundIncluded("a"), new BoundExcluded("z"));

    // Values
    const _dt = new DateTime(new Date());
    const _dec = new Decimal("3.14");
    const _dur = new Duration("1h30m");

    // CRUD
    const _created = await db.create<Person>(table).content({ name: "Tobie", age: 30 });
    const _selected = await db.select<Person>(table);
    const _updated = await db.update<Person>(_stringId).merge({ age: 31 });
    const _deleted = await db.delete(_stringId);

    // Queries
    const [_result] = await db
        .query("SELECT * FROM $table WHERE age > $age", { table, age: 25 })
        .collect<[Person[]]>();

    // Streamed results: a frame of a statement which answers with a list of records carries one
    // of those records, and one which answers with a single value carries that value.
    for await (const frame of db.select<Person>(table).stream()) {
        if (frame.isValue()) {
            const _row: Person = frame.value;
        }
    }

    for await (const frame of db.select<Person>(_stringId).stream()) {
        if (frame.isValue()) {
            const _only: Person | undefined = frame.value;
        }
    }

    for await (const frame of db.insert<Person>(table, [{ name: "Tobie", age: 30 }]).stream()) {
        if (frame.isValue()) {
            const _inserted: Person = frame.value;
        }
    }

    for await (const frame of db.run<number>("fn::count").stream()) {
        if (frame.isValue()) {
            // A `RETURN` is one value, so the frame carries the whole result.
            const _returned: number = frame.value;
        }
    }

    // Live queries
    const stream = await db.live(table);
    for await (const { action, value } of stream) {
        if (action === "CREATE") {
            console.log(value);
        }
    }
}
