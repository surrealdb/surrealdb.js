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

    // Authentication providers
    const url = "ws://localhost:8000";

    await db.connect(url, { authentication: { username: "root", password: "root" } });
    await db.connect(url, { authentication: "an.access.token" });
    await db.connect(url, { authentication: null });

    // Anything accepted by `signin()` may be provided, or returned from a function
    await db.connect(url, {
        authentication: { access: "user", variables: { id: 1, email: "tobie@example.com" } },
    });
    await db.connect(url, { authentication: () => ({ access: "bearer", key: "grant-key" }) });
    await db.connect(url, {
        authentication: async (session) => ({
            access: "staff",
            username: session ? "forked" : "default",
            password: "secret",
        }),
    });
    await db.connect(url, { authentication: async () => null });

    // A resolver evaluated when connecting, or for each request
    await db.connect(url, { authentication: { resolve: () => "token", when: "connect" } });
    await db.connect(url, { authentication: { resolve: () => "token" } });
    await db.connect(url, {
        authentication: {
            resolve: async () => ({ access: "user", variables: { id: 1 } }),
            when: "request",
        },
        expiryMargin: 30,
    });
    await db.connect(url, {
        authentication: { resolve: () => "token", when: "request", cache: "until-expiry" },
    });
    await db.connect(url, {
        authentication: { resolve: () => "token", when: "request", cache: "none" },
    });
    await db.connect(url, {
        authentication: { resolve: () => "token", when: "request", cache: { ttl: 300 } },
    });

    const resolve = () => "token";

    // @ts-expect-error a cache policy only applies to credentials resolved for each request
    await db.connect(url, { authentication: { resolve, when: "connect", cache: "none" } });
    // @ts-expect-error a cache policy only applies to credentials resolved for each request
    await db.connect(url, { authentication: { resolve, cache: "none" } });
    // @ts-expect-error the cache policy is not known
    await db.connect(url, { authentication: { resolve, when: "request", cache: "forever" } });
    // @ts-expect-error credentials are resolved on connect or on request
    await db.connect(url, { authentication: { resolve, when: "sometimes" } });

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

    // Calls made as a different identity than the session, for that call only
    const _asToken = await db.select<Person>(table).as("an.access.token");
    const _asDetails = await db.select<Person>(table).as({ access: "user", variables: { id: 1 } });
    const [_asResult] = await db
        .query("SELECT * FROM person")
        .as("an.access.token")
        .collect<[Person[]]>();
    const _asChained = await db
        .select<Person>(table)
        .as("an.access.token")
        .fields("name")
        .limit(10);
    await db.create<Person>(table).as("an.access.token").content({ name: "Tobie", age: 30 });
    await db.update<Person>(_stringId).as("an.access.token").merge({ age: 31 });
    await db.upsert<Person>(_stringId).as("an.access.token").merge({ age: 31 });
    await db.delete(_stringId).as("an.access.token");
    await db.insert<Person>(table, { name: "Tobie", age: 30 }).as("an.access.token");
    await db.relate(_stringId, new Table("knows"), _numberId).as("an.access.token");
    await db.run<number>("fn::example").as("an.access.token");
    await db.auth<Person>().as("an.access.token");
    await db.api().get("/example").as("an.access.token");
    // @ts-expect-error a credential is required
    db.select<Person>(table).as();
    // @ts-expect-error a credential is a token or authentication details
    db.select<Person>(table).as(123);

    // Live queries
    const stream = await db.live(table);
    for await (const { action, value } of stream) {
        if (action === "CREATE") {
            console.log(value);
        }
    }
}
