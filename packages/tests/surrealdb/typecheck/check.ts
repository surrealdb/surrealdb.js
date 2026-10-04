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
    type SurrealRequestScope,
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

    // Cancellation: a signal, and a client side request timeout, on queries and on every builder
    const controller = new AbortController();
    const signal = controller.signal;

    const [_abortable] = await db
        .query("SELECT * FROM person")
        .signal(signal)
        .requestTimeout(5_000)
        .collect<[Person[]]>();
    const _responses = await db
        .query("SELECT * FROM person")
        .signal(signal)
        .responses<[Person[]]>();

    // The result of a builder is typed as it is without them, and chaining keeps it
    const _signalled: Person[] = await db.select<Person>(table).signal(signal);
    const _timed: Person[] = await db.select<Person>(table).requestTimeout(1_000).limit(1);
    const _both: Person[] = await db
        .create<Person>(table)
        .content({ name: "Tobie", age: 30 })
        .signal(AbortSignal.timeout(2_000))
        .requestTimeout(0);
    const _json = await db.select<Person>(table).json().signal(signal);

    // A signal may be missing, as `request.signal` is on some runtimes
    const _optional = await db.select<Person>(table).signal(undefined as AbortSignal | undefined);

    await db.update<Person>(_stringId).merge({ age: 32 }).signal(signal);
    await db.upsert<Person>(_stringId).merge({ age: 32 }).signal(signal);
    await db.delete(_stringId).signal(signal);
    await db.insert<Person>(table, [{ name: "Tobie", age: 30 }]).signal(signal);
    await db.relate(_stringId, new Table("knows"), _numberId).signal(signal);
    await db.run<number>("fn::count").signal(signal).requestTimeout(10);
    await db.auth<Person>().signal(signal);
    await db.api().get("/people").signal(signal);

    // Aborting ends the iteration of a stream, which is otherwise typed as it is without a signal
    for await (const frame of db.select<Person>(table).signal(signal).stream()) {
        if (frame.isValue()) {
            console.log(frame.value);
        }
    }

    // A view of the session bound to the signal of a request, with the same API
    const scoped: SurrealRequestScope = db.withSignal(signal);
    const _scopedPeople: Person[] = await scoped.select<Person>(table);
    const _scopedCreated = await scoped.create<Person>(table).content({ name: "Tobie", age: 30 });
    const [_scopedResult] = await scoped.query("SELECT * FROM person").collect<[Person[]]>();
    const _nested: Person[] = await scoped
        .withSignal(AbortSignal.timeout(500))
        .select<Person>(table);
    const _fromAnySession: Person[] = await (await db.forkSession())
        .withSignal(signal)
        .select<Person>(table);

    // A live subscription made through a view is killed when its signal aborts
    const scopedLive = await scoped.live<Person>(table);
    const _alive: boolean = scopedLive.isAlive;
    for await (const { action } of scopedLive) {
        console.log(action);
    }
    const _unmanagedLive = await scoped.liveOf(Uuid.v4());
    await scopedLive.kill();

    // Transactions begun on a scope, or given a signal after the fact
    const scopedTransaction = await scoped.beginTransaction();
    await scopedTransaction.select<Person>(table);
    await scopedTransaction.commit();

    const transaction = await db.beginTransaction();
    const boundTransaction = transaction.withSignal(signal);
    await boundTransaction.query("SELECT * FROM person").signal(signal);
    await boundTransaction.cancel();

    // Options: a default limit for the connection, and extras for `fetch`
    await db.connect("ws://localhost:8000", { requestTimeout: 5_000 });
    const _driver = new Surreal({
        fetchOptions: { cache: "no-store", credentials: "include", keepalive: true },
    });

    // @ts-expect-error a signal is an AbortSignal
    db.query("SELECT * FROM person").signal("not a signal");

    // @ts-expect-error a request timeout is a number of milliseconds
    db.query("SELECT * FROM person").requestTimeout("5s");

    // @ts-expect-error a request timeout is not a Duration, which is for the TIMEOUT clause
    db.query("SELECT * FROM person").requestTimeout(new Duration("5s"));

    // @ts-expect-error a request timeout is a number of milliseconds
    await db.connect("ws://localhost:8000", { requestTimeout: "5s" });

    // @ts-expect-error the method of a fetch request belongs to the SDK
    new Surreal({ fetchOptions: { method: "GET" } });

    // Live queries
    const stream = await db.live(table);
    for await (const { action, value } of stream) {
        if (action === "CREATE") {
            console.log(value);
        }
    }
}
