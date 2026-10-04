import {
    BoundExcluded,
    BoundIncluded,
    BoundQuery,
    DateTime,
    Decimal,
    Duration,
    type QueryLike,
    RecordId,
    RecordIdRange,
    StringRecordId,
    Surreal,
    surql,
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

async function _batch() {
    const db = new Surreal();
    const table = new Table("person");

    // A list of queries is typed by a tuple of statement results, like a single query is.
    const [_everyone, _adults] = await db
        .query<[Person[], Person[]]>([
            db.select<Person>(table),
            surql`SELECT * FROM person WHERE age >= ${18}`,
        ])
        .collect();

    const _people: Person[] = _everyone;
    const _grownups: Person[] = _adults;

    // Which defaults to untyped results
    const _untyped: unknown[] = await db.query(["RETURN 1", "RETURN 2"]);

    // Strings, bound queries, query builders and queries can all be combined, from a mutable
    // or a readonly list, and any of them can be kept as a QueryLike.
    const _input: QueryLike = "RETURN 1";
    const _inputs: readonly QueryLike[] = [
        _input,
        new BoundQuery("RETURN $a", { a: 1 }),
        db.select<Person>(table),
        db.create<Person>(table),
        db.run<number>("fn::count"),
        db.query("RETURN 2"),
        db.query<[number]>("RETURN 3").json(),
        db.select<Person>(table).json(),
    ];

    await db.query(_inputs);
    await db.query(["RETURN 1"] as const);

    // The query which comes back can be configured and consumed as any other
    const [_count] = await db.query<[number]>(["RETURN 1"]).json().retry().collect();
    const [_response] = await db.query<[number]>(["RETURN 1"]).responses();

    if (_response.success) {
        const _result: number = _response.result;
    }

    for await (const frame of db.query(["RETURN 1", "RETURN 2"]).stream<number>()) {
        if (frame.isValueOf(1)) {
            const _value: number = frame.value;
        }
    }

    // @ts-expect-error A list holds queries, not numbers
    db.query([1, 2]);

    // @ts-expect-error The bindings belong to each query of the list
    db.query(["RETURN $a"], { a: 1 });

    // A list of queries is available inside of an interactive transaction as well
    const txn = await db.beginTransaction();
    await txn.query<[number, number]>(["RETURN 1", "RETURN 2"]);
}
