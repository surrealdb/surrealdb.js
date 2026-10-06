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
    ServerError,
    StringRecordId,
    Surreal,
    type SurrealRequestScope,
    surql,
    Table,
    type TransactionOptions,
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

    // A resolver evaluated when connecting, or for each request, where the cache defaults to "none"
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

    // The identity of a call goes together with its signal and its timeout, in either order, on a
    // view as well, and does not change what the call resolves to
    const _asSignalled: Person[] = await db
        .select<Person>(table)
        .as("an.access.token")
        .signal(signal)
        .requestTimeout(5_000);
    const _signalledAs: Person[] = await db
        .select<Person>(table)
        .requestTimeout(5_000)
        .signal(signal)
        .as({ access: "user", variables: { id: 1 } });
    const _asScoped: Person[] = await scoped.select<Person>(table).as("an.access.token");
    const [_asQuery] = await scoped
        .query<[Person[]]>("SELECT * FROM person")
        .signal(signal)
        .as("an.access.token")
        .collect();
    await db.run<number>("fn::count").as("an.access.token").signal(signal).requestTimeout(10);
    await db.auth<Person>().signal(signal).as("an.access.token");
    // @ts-expect-error a credential is a token or authentication details, whatever else is chained
    db.select<Person>(table).signal(signal).as(123);

    // A list of queries, and an atomic transaction, are bound to the signal like any other query
    const [_scopedList] = await scoped
        .query<[Person[]]>([db.select<Person>(table), "SELECT * FROM person"])
        .requestTimeout(1_000)
        .collect();
    const _listed = await db.query(["SELECT * FROM person"]).signal(signal).responses();
    const [_scopedFrom, _scopedTo] = await scoped.transaction<[Person, Person]>(
        [
            db.update<Person>(_stringId).merge({ age: 1 }),
            surql`UPDATE ONLY ${_numberId} SET age += ${1}`,
        ],
        { retry: true, signal, requestTimeout: 5_000 },
    );
    const _transactionResults: unknown[] = await db.transaction(["'a'"], {
        signal: AbortSignal.timeout(2_000),
        requestTimeout: 0,
    });

    // A transaction as a different identity, which is a request like any other
    const _transactionAs: unknown[] = await db.transaction(["'a'"], {
        as: "an.access.token",
        signal,
        requestTimeout: 5_000,
    });
    await scoped.transaction(["'a'"], { as: { access: "user", variables: { id: 1 } } });

    // @ts-expect-error the identity of a transaction is a token or authentication details
    await scoped.transaction(["'a'"], { as: 123 });

    // @ts-expect-error a transaction's signal is an AbortSignal
    await scoped.transaction(["'a'"], { signal: "not a signal" });

    // @ts-expect-error a transaction's request timeout is a number of milliseconds
    await scoped.transaction(["'a'"], { requestTimeout: "5s" });

    // @ts-expect-error a view takes a list of queries, as a session does
    await scoped.transaction("'a'");

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

async function _transaction() {
    const db = new Surreal();

    // Atomic transactions take a list of queries, and resolve to the same tuple of results
    const [_from, _to] = await db.transaction<[Person, Person]>(
        [
            db.update<Person>(new RecordId("person", "a")).merge({ age: 1 }),
            surql`UPDATE ONLY ${new RecordId("person", "b")} SET age += ${1}`,
        ],
        { retry: true },
    );

    const _source: Person = _from;
    const _target: Person = _to;

    const _results: unknown[] = await db.transaction(["RETURN 1"]);

    // The retry can be configured like any other
    const _options: TransactionOptions = {
        retry: { attempts: 3, retryable: (error) => error instanceof ServerError },
    };

    await db.transaction(["RETURN 1"], _options);
    await db.transaction(["RETURN 1"], { retry: false });

    // @ts-expect-error The callback form is not available yet
    await db.transaction(async () => {});

    // @ts-expect-error A transaction takes a list of queries, not one
    await db.transaction("RETURN 1");

    // A session can run one, but a transaction cannot start another inside itself
    const session = await db.newSession();
    await session.transaction(["RETURN 1"]);

    const txn = await db.beginTransaction();

    // @ts-expect-error Transactions do not nest
    await txn.transaction(["RETURN 1"]);
}
