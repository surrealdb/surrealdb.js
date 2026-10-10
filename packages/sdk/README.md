<br>

<p align="center">
    <img width=120 src="https://raw.githubusercontent.com/surrealdb/icons/main/surreal.svg" />
</p>

<h1 align="center">surrealdb</h1><br/>
<p align="center">The official SurrealDB SDK for JavaScript</p>

<br>

<p align="center">
    <img width=74 src="https://raw.githubusercontent.com/surrealdb/icons/main/javascript.svg" />
    &nbsp;
    <img width=74 src="https://raw.githubusercontent.com/surrealdb/icons/main/webassembly.svg" />
    &nbsp;
    <img width=74 src="https://raw.githubusercontent.com/surrealdb/icons/main/nodejs.svg" />
</p>

<br>

<p align="center">
    <a href="https://github.com/surrealdb/surrealdb.js"><img src="https://img.shields.io/badge/status-stable-ff00bb.svg?style=flat-square"></a>
    &nbsp;
    <a href="https://surrealdb.com/docs/sdk/javascript"><img src="https://img.shields.io/badge/docs-view-44cc11.svg?style=flat-square"></a>
    &nbsp;
    <a href="https://www.npmjs.com/package/surrealdb"><img src="https://img.shields.io/npm/v/surrealdb?style=flat-square"></a>
    &nbsp;
    <a href="https://www.npmjs.com/package/surrealdb"><img src="https://img.shields.io/npm/dm/surrealdb?style=flat-square"></a>
    &nbsp;
    <a href="https://deno.land/x/surrealdb"><img src="https://img.shields.io/npm/v/surrealdb?style=flat-square&label=deno"></a>
</p>

<p align="center">
    <a href="https://surrealdb.com/discord"><img src="https://img.shields.io/discord/902568124350599239?label=discord&style=flat-square&color=5a66f6"></a>
    &nbsp;
    <a href="https://twitter.com/surrealdb"><img src="https://img.shields.io/badge/twitter-follow_us-1d9bf0.svg?style=flat-square"></a>
    &nbsp;
    <a href="https://www.linkedin.com/company/surrealdb/"><img src="https://img.shields.io/badge/linkedin-connect_with_us-0a66c2.svg?style=flat-square"></a>
    &nbsp;
    <a href="https://www.youtube.com/@SurrealDB"><img src="https://img.shields.io/badge/youtube-subscribe-fc1c1c.svg?style=flat-square"></a>
</p>

## Documentation

View the SDK documentation [here](https://surrealdb.com/docs/sdk/javascript).

## Learn SurrealDB

- A Tour of SurrealDB: https://surrealdb.com/learn/tour
- Aeon's Surreal Renaissance (Interactive book): https://surrealdb.com/learn/book
- Documentation: https://surrealdb.com/docs

## What is this package?

The **`surrealdb`** package is the official JavaScript SDK for [SurrealDB](https://surrealdb.com). It connects to remote SurrealDB instances over WebSocket or HTTP, and supports embedded databases through optional engine plugins.

The SDK provides:

- **`Surreal` client** - connect, authenticate, query, subscribe to live updates, and manage sessions
- **Type-safe query builders** - `.select()`, `.create()`, `.update()`, `.delete()`, and more
- **Bound queries** - `surql` templates and `BoundQuery` for safe parameterisation
- **Remote engines** - `ws`, `wss`, `http`, and `https` transport out of the box
- **SQON re-exports** - all value types, codecs, and core utilities from [`@surrealdb/sqon`](https://www.npmjs.com/package/@surrealdb/sqon)

Works in Node.js, Bun, Deno, and browsers. For embedded databases, install an engine plugin separately - see [Related packages](#related-packages).

## How to install

### Install with a package manager

```sh
# using npm
npm i surrealdb

# or using pnpm
pnpm i surrealdb

# or using yarn
yarn add surrealdb

# or using bun
bun add surrealdb
```

You can now import the SDK into your project with:

```ts
import { Surreal } from "surrealdb";
```

### Install for the browser with a CDN

For fast prototyping we provide a browser-ready bundle. You can import it with:

```ts
import Surreal from "https://unpkg.com/surrealdb";
// or
import Surreal from "https://cdn.jsdelivr.net/npm/surrealdb";
```

_**NOTE: this bundle is not optimised for production! So don't use it in production!**_

## Getting started

In the example below you can see how to connect to a remote instance of SurrealDB, authenticate with the database, and issue queries for creating, updating, and selecting data from records.

### Don't have a SurrealDB instance yet?

If you don't already have a SurrealDB instance running, you can easily get started by using Surreal Cloud. Simply [sign up here](https://app.surrealdb.com/signin/deploy) to provision a free SurrealDB instance in the cloud. This will allow you to experiment with SurrealDB without any local setup, and you'll be able to connect to your new instance right away.

### Connecting

The first step in using the SDK is to instantiate the SurrealDB client, after which you can connect to a SurrealDB instance using a connection URI. After that, select a namespace and database, and sign in as a namespace, database, root, or record user.

Make sure you have created a user before you sign in.

```ts
import { Surreal, RecordId, Table } from "surrealdb";

// Instantiate the SurrealDB client
const db = new Surreal();

// Connect to the specified instance
await db.connect("wss://my-instance.aws-euw1.surreal.cloud");

// Select a specific namespace / database
await db.use({
    namespace: "test",
    database: "test",
});

// Sign in as a namespace, database, root, or record user
await db.signin({
    username: "root",
    password: "root",
});
```

### Authentication

Instead of calling `db.signin()` yourself, you can give the SDK the credentials with the `authentication` option of `connect()`. They are applied when the connection is established, applied again when it is re-established, and renewed when the session is about to expire.

```ts
// A token
await db.connect(url, { authentication: process.env.SURREAL_TOKEN });

// Anything which `signin()` accepts, such as a system user
await db.connect(url, { authentication: { username: "root", password: "root" } });

// Or a function which computes either, and may be asynchronous. It can return a token, a system
// user, record access `variables`, a bearer access `key`, or `null` for no authentication.
await db.connect(url, {
    namespace: "app",
    database: "app",
    authentication: async () => ({
        access: "account",
        variables: { email, password: await readPassword() },
    }),
});
```

When the function throws, or returns something which cannot be used, the connection fails with an `AuthResolverError` with the original error as its `cause`. Neither the message of the error nor the error itself repeats what was returned, as that may be a credential.

When renewing the session fails, for example because the identity provider is briefly unreachable, the renewal is tried again, backing off the way reconnecting does, until it succeeds or the token expires, and the session is invalidated then. The delays are those of the `reconnect` option (`retryDelay`, `retryDelayMax`, `retryDelayMultiplier` and `retryDelayJitter`), and `reconnect: false` turns retrying off. Its `attempts` do not apply, as how long to keep trying is for the token to decide. The `error` event reports the first failure of a renewal, and the last one when the session is invalidated, and not every attempt in between. Signing in again, invalidating or closing the session, and closing the connection all end the retries.

Using `signin()`, `signup()`, or `authenticate()` yourself takes over from the `authentication` option for that session.

#### Resolving credentials for each request

Give `authentication` a resolver with `when: "request"` to evaluate the function as requests are made, instead of when connecting. This suits tokens which are rotated out of band, identities which differ from request to request, and connections which do not live long, such as one for each invocation on a serverless platform. Nothing is resolved when connecting, and no timers are started.

There are two recipes, which differ in what the function may depend on:

```ts
// The identity is that of whoever is asking, so it is decided for every request. This is
// the default: `cache: "none"`. The function may read it from the request being handled.
await db.connect("https://example.surrealdb.com", {
    namespace: "app",
    database: "app",
    authentication: {
        resolve: () => requestContext.getStore()?.token ?? null,
        when: "request",
    },
});

// The identity is the same for everyone, such as a service token which is rotated, so it is
// reused until it is about to expire. The function must not depend on the current request.
await db.connect("https://example.surrealdb.com", {
    namespace: "app",
    database: "app",
    authentication: {
        resolve: async () => await identityProvider.issueServiceToken(),
        when: "request",
        cache: "until-expiry",
    },
    expiryMargin: 60,
});
```

> **Warning:** with `cache: "until-expiry"` or `{ ttl }` the credential belongs to the session and is used for every request which is made on it, including the ones which are made while the first is still being resolved, which wait for it. If `resolve` returns something which depends on the current request, such as the user it is being handled for, everyone gets the credential which was resolved first. That is a security problem, which is why the default never reuses one.

The `cache` option decides when a resolved credential is used again instead of calling `resolve` again:

| `cache` | A resolved credential is used... |
| --- | --- |
| `"none"` (default) | never. `resolve` is evaluated for every request, and concurrent requests do not share the result. |
| `"until-expiry"` | until `expiryMargin` seconds before the `exp` claim of the token, and concurrent requests share one call to `resolve`. A token without an expiry, such as an opaque token, cannot be reused safely and is resolved for every request. |
| `{ ttl: 300 }` | for at most 300 seconds, and for a token with an expiry never beyond the point at which `"until-expiry"` would stop using it. This is how to bound the reuse of tokens without an expiry. |

When `resolve` returns authentication details rather than a token, they are signed in with whenever a credential is resolved, which with the default is for every request. Return a token, or choose a `cache`, when that is more than you want.

When `resolve` fails, the request is rejected with an `AuthResolverError` and is not sent. It is never sent without credentials or with an earlier credential instead, nothing about the session changes, and the failure is not remembered: the next request tries again.

How the credential is presented depends on the protocol:

- **HTTP:** the token is the `Authorization` header of the request. It is only ever sent to the origin of the connection, and requests which carry it do not follow redirects. When the server answers `401` the credential is resolved again and the request is sent again, once. The server answers `401` to a token it does not accept before it runs anything, so this is safe for every request, including writes. An error reported inside a successful response is not a `401`, as the request may have partly run, and is never sent again. Neither is an import which is streamed.
- **WebSocket:** the session is authenticated again, before the request is sent, whenever the credential has changed. The server is only told when it did, and requests wait for it. When the connection is re-established the credential is resolved again.

A credential belongs to the session, not to a request. Over HTTP `"none"` sends each request with what was resolved for it, so `resolve` may decide on the identity of each one. Over WebSocket requests which share a session share an identity, as a session holds one, so what was resolved for each request is applied to it one request after the other. Calling `db.invalidate()` discards the credential, and the next request resolves a new one.

Resolving a credential is something a request waits for, so it is [cancelled and limited](#cancelling-queries-and-setting-timeouts) like the rest of the request:

- When the signal of the request aborts, or its `requestTimeout` (or the one of the connection) runs out, while `resolve` is working, while authentication details are being exchanged for a token, or while the request is waiting for a `401` to be answered with a new credential, the request rejects at once with the reason of the signal, and nothing more is sent for it. When the resolver fails at the same moment, the abort is what is reported, and not the failure.
- A signal which has aborted already does not call `resolve`.
- Abandoning a request does not abandon the work which was begun for it. `resolve` is not told, so it runs to the end, and what it resolves is kept as the cache says for the requests which follow and which share it, and are not abandoned by it. Over WebSocket a credential which was being applied to the session is applied in full, rather than left half done, and a resolution which was queued behind another and had not begun when its request was abandoned never begins.
- A request which is abandoned while the credential is being resolved is never sent with a credential which was not resolved for it, or without one.
- The transactions of `transaction()` are a request like any other, and so they are resolved for, authenticated, and abandoned in the same way. `beginTransaction()` waits for the session to be authenticated before it begins, so that the identity of the transaction does not change in the middle of it, and one which a signal abandons while it is waiting is cancelled when it does begin.

Over WebSocket the server goes on running a query which was abandoned, and on some servers (the next request timed out after one on 3.0.0 and on the nightly build, and not on 2.x or 3.2.3, apparently because the session is held until the query has finished) the request which follows it, and which has to sign the session in again because a credential is resolved for it, is not answered before then. The request which was abandoned is not affected, it has stopped waiting.

A resolver which never settles holds up the requests which queue behind it over WebSocket. Give those requests a `requestTimeout`, or a signal, to be rid of them, and make `resolve` give up by itself.

On a connection which resolves credentials for each request, `.as()` and the `as` option of `transaction()` take precedence over the resolver for that call, which is not asked for a credential.

#### Running a call as someone else

Over HTTP a single call can be run as a different identity, without changing the session which other calls share. Chain `.as()` to a query or any of the query builders with an access token, or with anything `signin()` accepts:

```ts
const notes = await db.select(new Table("note")).as(userToken);

const [mine] = await db.query("SELECT * FROM note").as(userToken).collect();

const me = await db.auth().as({ access: "account", variables: { email, password } });
```

The credential is the `Authorization` header of that request only. The selected namespace and database stay as they are, and the session does not authenticate with it, so concurrent calls for different users can share one connection. Authentication details are exchanged for a token first, which costs one more request. A token is not checked until the server sees it, and a call which is refused is not sent again.

This needs an engine which presents credentials with every request. On a WebSocket connection `.as()` rejects the call with an `UnsupportedFeatureError`, rather than running it as the session, which would be the wrong identity. There, create a session for the identity with `db.forkSession()` and call `authenticate()` on it.

`.as()` goes together with the way a call is [cancelled and limited](#cancelling-queries-and-setting-timeouts), on `.query()` and on every query builder, in whichever order they are chained, and through a view made with `withSignal()`. The identity of the call is the one the request is made as, and the signal and the timeout are the ones it is abandoned by:

```ts
const notes = await db
    .select(new Table("note"))
    .as(userToken)
    .signal(request.signal)
    .requestTimeout(5_000);

// The same, for everything which a request handler does, as someone else or not
const scoped = db.withSignal(request.signal);

await scoped.select(new Table("note")).as(userToken);
await scoped.select(new Table("note")); // as the session

// An atomic transaction is a single request, and so it is run as one identity as a whole
await db.transaction([surql`CREATE note SET owner = ${userId}`], {
    as: userToken,
    signal: request.signal,
});
```

Authentication details which are exchanged for a token are part of what the call waits for, so a call which is abandoned while that is going on rejects with the reason of the signal at once, and is not sent afterwards.

`import()`, `export()` and `exportModel()` take `.as()` too, together with `.signal()` and `.requestTimeout()` and through a view made with `withSignal()`, and are run as that identity or are refused in the same way. What is exported or imported is what the server lets that identity do, which for an export is a privilege, so an identity without it is refused with an `HttpConnectionError`:

```ts
// Export as the identity of the user the request is for, if they are allowed to
const sql = await db.export().as(userToken).signal(request.signal);

await db.withSignal(request.signal).import(sql).as(adminToken);
```

A list of queries is run as a single request, as one identity, so `.as()` is called on the combined query, and not on the items of the list. An item which was given an identity of its own is refused when the list is made, with an `ExpressionError`, rather than run as the session, which would be a different identity from the one it was given.

```ts
// Run the whole list as the user
await db.query([db.select(table), "RETURN 1"]).as(userToken);

// An item which asks for an identity of its own is refused, and nothing is sent
db.query([db.select(table).as(userToken), "RETURN 1"]); // throws an ExpressionError
```

### Sending queries

After you have connected to a SurrealDB instance, you can send queries to the database. Queries can be sent in two ways:

- Type-safe using the query builder methods
- As a string using the `query` method

#### Type-safe query builders

```ts
const personTable = new Table("person");

// Create a new person with a random id
let [created] = await db.create<Person>(personTable).content({
    title: "Founder & CEO",
    name: {
        first: "Tobie",
        last: "Morgan Hitchcock",
    },
    marketing: false,
});

// Create a record with a specific id
let specific = await db.create<Person>(new RecordId("person", "tobie")).content({
    title: "Founder & CEO",
    name: {
        first: "Tobie",
        last: "Morgan Hitchcock",
    },
    marketing: true,
});

// Insert one or multiple records in bulk
let inserted = await db.insert<Person>(personTable, [
    { title: "Engineer", name: { first: "Alice", last: "Smith" }, marketing: false },
    { title: "Designer", name: { first: "Bob", last: "Jones" }, marketing: true },
]);

// Update a person record with a specific id
let updated = await db.update<Person>(created.id).merge({
    marketing: true,
});

// Select all people records
let people = await db.select<Person>(personTable);
```

##### Choosing between `create()` and `insert()`

While both `create()` and `insert()` add new records to the database, they correspond to different SurrealQL statements (`CREATE` vs `INSERT`) and serve distinct use cases:

| Feature | `create()` (`CREATE`) | `insert()` (`INSERT`) |
| --- | --- | --- |
| **Primary use case** | Creating a single record with mutation builders | Ingesting single or multiple records in bulk |
| **Target argument** | `Table` or `RecordId`: `db.create(target)` | `Table` and records, or records directly: `db.insert(table, data)` |
| **Bulk insertion** | No (targets a single record or table) | Yes (accepts `Values<T>[]`) |
| **Data specification** | Chained methods: `.content()`, `.set()`, `.merge()`, `.patch()` | Passed directly as argument |
| **Duplicate handling** | Fails if the record already exists | Fails by default, or skips conflicts with `.ignore()` (`INSERT IGNORE`) |
| **Relations** | No (use `db.relate()`) | Yes, with `.relation()` (`INSERT RELATION`) |

**Use `create()` when:**
- You are creating an individual record and want to specify the target `RecordId` directly: `db.create(new RecordId("person", "tobie")).content(...)`.
- You want to use mutation builders like `.set()`, `.merge()`, or `.patch()`.
- You expect the record ID not to exist yet and want SurrealDB to reject the operation if a record with that ID already exists.

**Use `insert()` when:**
- You are inserting multiple records at once (bulk ingestion).
- You want to skip duplicate keys without throwing an error by chaining `.ignore()`.
- Your record data already includes its own `id` field: `db.insert([{ id: new RecordId("person", "1"), ... }])`.
- Note: Passing a bare `RecordId` to `insert()` (e.g. `db.insert(recordId)`) throws an error because `INSERT` operates on tables or record payloads. Use `db.create(recordId).content(data)` instead.

#### String based queries

```ts
const personTable = new Table("person");

// Execute a query and collect the results
let [created] = await db
    .query("CREATE ONLY $table CONTENT $content", {
        table: personTable,
        content: {
            title: "Founder & CEO",
            name: {
                first: "Tobie",
                last: "Morgan Hitchcock",
            },
        },
    })
    .collect<[Person]>();
```

#### Streaming results

Against a server which supports it (SurrealDB 3.3.0 and later, over WebSocket), a query is answered
as its results are produced instead of in one response, so the first rows are available while the
rest of the query is still running. Nothing changes for `collect()`: it returns the same answer,
and a server which cannot stream answers as it always has.

To work with rows as they arrive, ask for them:

```ts
for await (const person of db.query<[Person[]]>("SELECT * FROM person").rows()) {
    console.log(person.name);
}

// Query builders stream their records the same way, and a parse function is applied to each
// row as it arrives, which is where a row can be validated before the query is held whole.
for await (const person of db.select<Person>(table).rows(Person.parse)) {
    console.log(person);
}
```

For a query of several statements `rows()` yields the rows of each in turn. Use `statements()` when
the statements need to be told apart, or when each should be received whole, once it is final:

```ts
const sql = "SELECT * FROM person; SELECT * FROM company";

for await (const statement of db.query<[Person[], Company[]]>(sql).statements()) {
    console.log(statement.index, statement.value.length);
}
```

Rows arrive before the statement which produced them has finished, so **a row is provisional until
iteration completes without throwing**: a statement which fails afterwards voids the rows it
yielded, and iteration throws its error. A statement which `statements()` has yielded is never
voided by that statement failing, as it is only yielded once it is complete; a stream which fails
as a whole afterwards, such as by losing its connection, still throws.

Streams are read, not retried: `retry()` applies to `collect()` alone, as a query cannot be sent
again once some of its answer has been read.

Leaving the loop stops the query on the server rather than leaving it to produce results nothing
will read, so `break` is how to take the first few rows of a large table. A read which is waiting
for the server is let go of at once, and `await using` does the same when the stream is not read to
its end:

```ts
await using people = db.select<Person>(table).rows();

const first = await people.next();
```

Two things to know. Rows which have arrived and not yet been read are held in memory, and the
WebSocket API has no way to pause the server, so a reader which is slower than the server holds the
difference until it catches up; leaving is how that is stopped. And a stream inside a transaction
must be read to its end **before** you commit: requests on a connection are served concurrently, so
a `commit` which arrives while the query is still executing commits only the part which had run.

`.stream()` gives the lower level view: every value, error and completion of every statement as a
frame, which is what to use to see one statement fail while the statements after it carry on.

#### Running several queries at once

Pass a list to `query` to run several queries in a single request. Each item can be a string,
a `surql` template, or a query builder such as `select()` and `create()`. The result is the same
`Query` you would get from a single string, so `.collect()`, `.responses()` and `.stream()` all work.

```ts
import { surql, Table } from "surrealdb";

const [people, adults] = await db
    .query<[Person[], Person[]]>([
        db.select<Person>(personTable),
        surql`SELECT * FROM person WHERE age >= ${18}`,
    ])
    .collect();
```

A list of queries is a **batch**, not a transaction. It behaves exactly as if the statements had
been written one after another in a single query: nothing is atomic, a failing statement does not
stop the ones after it, and whatever the others did stays done. Use `.responses()` to see which
statements failed without losing the results of the rest:

```ts
const [first, second] = await db.query(["RETURN 1", "THROW 'oops'"]).responses();

first.success; // true
second.success; // false
```

Results are positional **per statement**, not per item. An item holding several statements, such as
`"CREATE a; CREATE b"`, takes several slots in the results and moves the results of the items after
it, while a query builder always takes exactly one. An item cannot be empty, and two items cannot
bind the same parameter name (the `surql` template and query builders generate unique names, so
this only concerns a `BoundQuery` you wrote by hand).

#### Atomic transactions

Use `transaction` to run a list of queries atomically: either every change is applied or none is.
The queries are wrapped in `BEGIN` and `COMMIT` and sent in a single request, so unlike
`beginTransaction()` it does not hold any state on the connection and works over HTTP as well as
WebSockets.

```ts
const [from, to] = await db.transaction<[Account, Account]>([
    surql`UPDATE ONLY ${fromId} SET balance -= ${amount}`,
    surql`UPDATE ONLY ${toId} SET balance += ${amount}`,
]);
```

It resolves to the result of each statement, in order, or rejects with the error which made the
transaction fail. That is the error of the statement which actually failed, not one of the "not
executed" errors the server reports for the statements it rolled back.

Queries must not contain `BEGIN`, `COMMIT` or `CANCEL` statements, as `transaction` adds its own. A
`RETURN` statement is only allowed as the last statement, because `RETURN` ends a transaction early
in SurrealQL: the statements after it would be skipped, and the transaction would still commit.
Use `SELECT` or a bare expression to produce a value in the middle of a transaction. A `RETURN`
nested inside a block, such as an `IF`, ends the transaction in the same way, but cannot be
detected, so take care with those. Before SurrealDB 3.0 a `RETURN` also replaces the results of
the statements before it, so no `RETURN` is allowed at all.

Under concurrent load a transaction can fail because another one wrote to the same data. As the
whole transaction is sent at once it is always safe to replay, so it can opt into retrying with
the `retry` option, which defaults to the `retry` configured when connecting:

```ts
await db.transaction(
    [
        surql`UPDATE counter:visits SET count += 1`,
        surql`CREATE visit SET at = time::now()`,
    ],
    { retry: true },
);
```

As with any retry, a conflict is only recognized by default when the server reports it as a structured
`TransactionConflict`, which SurrealDB 3.1.0 and later do. For earlier versions, give a `retryable`
predicate in the `retry` option, which is passed the error which made the transaction fail.

To run queries inside a transaction which you control, such as to read before deciding what to
write, use `beginTransaction()` on a WebSocket connection. A list of queries can also be passed
to `query` on the returned transaction.

#### ISO GQL queries

In addition to SurrealQL, you can run [ISO GQL](https://www.iso.org/standard/76120.html)
(ISO/IEC 39075) queries with the `gql` method. It behaves exactly like `query`
— returning the same awaitable `Query` instance — but executes the string with
the server's GQL engine. A namespace and database must be selected first.

```ts
// Run a GQL query and collect the results
const [people] = await db.gql<[{ name: string }[]]>(
    "MATCH (p:person) WHERE p.age > $min RETURN p.name AS name ORDER BY name",
    { min: 21 },
);
```

> GQL is served by remote (WebSocket/HTTP) engines connected to a SurrealDB
> instance with GQL enabled.

### Subscribing to live queries

You can subscribe to live queries to receive updates when the data in the database changes.

```ts
// Subscribe to all records in the person table
const subscription = await db.live(personTable);

// Use an async iterator
for await (const { action, value } of subscription) {
    if (action === "CREATE") {
        console.log("A new person was created:", value);
    }
}
```

#### Managed (`live()`) vs unmanaged (`liveOf()`) live queries

The SDK provides two methods for live query subscriptions:

| Feature | `live()` (Managed) | `liveOf()` (Unmanaged) |
| --- | --- | --- |
| **Target** | `Table`, `RecordId`, or `RecordIdRange` | Live query UUID (`Uuid`) |
| **Query registration** | Automatically registers `LIVE SELECT` on the database | None (subscribes to an already registered query) |
| **Reconnection** | Automatically re-registers the query and resumes streaming on reconnect | Does not re-register (lifetime tied to original socket session) |
| **Lifecycle cleanup** | Automatically calls `KILL <uuid>` on `.kill()` or signal abort | Calls `KILL <uuid>` on `.kill()` or signal abort |

**Use `live()` (recommended)** for almost all application code. It handles registering the query on SurrealDB, streaming changes via an async iterator, and transparently re-subscribing if the WebSocket connection drops and reconnects:

```ts
const subscription = await db.live(new Table("person"));

for await (const { action, value } of subscription) {
    console.log(action, value);
}
```

**Use `liveOf()`** when you need to attach a listener to an existing live query that was initiated outside of the driver's managed query flow — such as a live query started with a raw SurrealQL query (`LIVE SELECT * FROM ...`) or a live query ID received from another service:

```ts
// Start a custom live query via raw SurrealQL
const [liveQueryId] = await db
    .query("LIVE SELECT * FROM person WHERE age > 18")
    .collect<[Uuid]>();

// Attach an unmanaged subscriber to receive notifications
const subscription = db.liveOf(liveQueryId);

for await (const { action, value } of subscription) {
    console.log(action, value);
}
```

### Cancelling queries and setting timeouts

Serverless functions and request handlers need to stop waiting on the database when the work they do is cancelled, or runs out of time. Every query can be given an [`AbortSignal`](https://developer.mozilla.org/docs/Web/API/AbortSignal), and the connection can be given a limit on how long to wait for an answer.

```ts
// Abandon a query when a signal aborts
const controller = new AbortController();
const people = await db.select<Person>(personTable).signal(controller.signal);

// Give up after two seconds
const [report] = await db
    .query("SELECT * FROM report")
    .signal(AbortSignal.timeout(2000))
    .collect<[Report[]]>();
```

`.signal()` is available on `.query()` and on every query builder: `select`, `create`, `update`, `upsert`, `delete`, `insert`, `relate`, `run`, `auth` and `api`. It works the same whether you await the query, call `.collect()` or `.responses()`, or read it with `.stream()`.

- A signal which has already aborted rejects straight away, and nothing is sent.
- When a signal aborts, the query stops waiting and rejects with the signal's `reason`, as it is. That is an `AbortError` for `controller.abort()` and a `TimeoutError` for `AbortSignal.timeout()`, so `error.name` tells a timeout from an abort the way it does for `fetch`. They are not wrapped in an SDK error, and they are not `SurrealError`s.
- A stream ends with the reason, and lets go of what it holds. A query which is waiting to be retried is not retried again.
- `.signal()` can be called more than once, and the query is abandoned when any of the signals aborts.
- A query which waits for credentials, because [they are resolved for each request](#resolving-credentials-for-each-request) or because it is [run as someone else](#running-a-call-as-someone-else), is abandoned while it waits for them as well.

**Aborting means "stop waiting", and nothing more.** The SDK stops waiting, and over HTTP the request is cancelled, but a SurrealDB server which has been sent a query may well carry on executing it. Over WebSocket there is no way to tell the server to stop, so it runs the query to the end and the answer is thrown away when it arrives. **A write which was sent before the signal aborted may or may not have been applied**, and a caller which needs to know has to check, for example by reading the record back or by making the write idempotent. Abandoned queries keep using resources on the server until they finish.

#### Timeouts

Set a default limit, in milliseconds, for every query on a connection, and override it for a query where it needs to differ:

```ts
await db.connect("wss://my-instance.aws-euw1.surreal.cloud", {
    requestTimeout: 5_000,
});

// Allow this one a minute, and this one as long as it takes
await db.query("SELECT * FROM report").requestTimeout(60_000);
await db.query("SELECT * FROM backfill").requestTimeout(0);
```

A query which takes longer fails with the `TimeoutError` of `AbortSignal.timeout()`. The limit applies to each request separately, so a query which is retried gets the full time for every attempt. It starts when the request is sent, and does not include the time spent waiting for a connection; to bound the whole of an operation, including retries, pass `AbortSignal.timeout()` to `.signal()` instead. It applies to queries, which includes a list of queries and an atomic `transaction()`, and not to signing in, selecting a namespace, the `begin` and `commit` of an interactive transaction, nor to import and export (see below).

`.requestTimeout()` is the way to _extend_ the default for a query. A signal can only ever shorten it, as the query is abandoned when the first of them fires.

This is not the `TIMEOUT` clause, which the query builders expose as `.timeout()`:

| | `.timeout(duration)` | `requestTimeout` and `.requestTimeout(ms)` |
| --- | --- | --- |
| Enforced by | The server, as a `TIMEOUT` clause in the query | The client, which stops waiting |
| Takes | A `Duration` | Milliseconds |
| On expiry | The server stops the query and reports a `QueryError` | The query fails with a `TimeoutError` and the server is not told |

#### Lists of queries and atomic transactions

A list of queries given to `query()` is a query like any other, so it takes `.signal()` and `.requestTimeout()`. `transaction()` takes the same as options, next to `retry`:

```ts
await db
    .query(["SELECT * FROM report", surql`SELECT * FROM person WHERE age >= ${18}`])
    .signal(request.signal)
    .collect();

await db.transaction(
    [
        surql`UPDATE ONLY ${fromId} SET balance -= ${amount}`,
        surql`UPDATE ONLY ${toId} SET balance += ${amount}`,
    ],
    { retry: true, signal: request.signal, requestTimeout: 5_000 },
);
```

- A transaction is a single request, so a signal or a `requestTimeout` abandons all of it at once. A signal which has already aborted sends nothing, and a transaction which is waiting to be retried is not retried again.
- The `requestTimeout` of the connection applies to a transaction as it does to any query, to each attempt in turn, and the option overrides it, with `0` for no limit.
- **An abandoned transaction may or may not have been committed.** The server is not told, and may well carry on to commit it. It is still atomic, so either all of its changes were applied or none was, but the client has to check which.
- When a transaction does fail, it is still the error which made it fail that is thrown, and not one of the "not executed" errors reported for its other statements, whether or not a signal is involved. A signal which aborts first wins, and its reason is thrown.
- `.signal()` and `.requestTimeout()` on the items of a list are ignored, like anything else configured on them: abandon the combined query, or call it on a view made with `withSignal()`. `.as()` on an item is not ignored, but refused with an `ExpressionError`, as a list is run as one identity: [call it on the combined query, or give `transaction()` the `as` option](#running-a-call-as-someone-else).

#### Scoping a request handler to its request

Rather than passing the signal of a request to every call, make a view of the connection which carries it with `withSignal()`. Everything made through the view is abandoned when the signal aborts, and has the same methods as the connection:

```ts
const scoped = db.withSignal(request.signal);

const people = await scoped.select<Person>(personTable);
const [report] = await scoped.query("SELECT * FROM report").collect<[Report[]]>();

// A signal for one call is combined with the one of the scope
await scoped.select<Person>(personTable).signal(AbortSignal.timeout(500));

// Lists of queries and atomic transactions are bound to the signal as well
await scoped.query(["SELECT * FROM report", "SELECT * FROM person"]).collect();
await scoped.transaction([surql`UPDATE counter:visits SET count += 1`], { retry: true });

// Transactions begun on the view are bound to the signal too
const txn = await scoped.beginTransaction();
```

The view is a cheap object (a `SurrealRequestScope`) which shares the connection and the session it was made from and does not change them, so make one for every request on a connection which is shared by all of them. It can be made from a session (`db`, or one from `forkSession()`), and from a transaction. The `commit()` of a transaction is not bound to the signal, so that abandoning a request can never leave the outcome of a commit in doubt. Live subscriptions are covered under "Live queries in a request handler" below.

**Cloudflare Workers**, or anywhere else a handler receives a `Request`:

```ts
export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        const db = new Surreal();
        await db.connect(env.SURREALDB_URL, {
            namespace: "app",
            database: "app",
            authentication: { username: env.SURREALDB_USER, password: env.SURREALDB_PASS },
            requestTimeout: 5_000,
        });

        try {
            const people = await db.withSignal(request.signal).select<Person>(personTable);
            return Response.json(people);
        } finally {
            await db.close();
        }
    },
};
```

**Next.js** route handlers, which are given the `Request`:

```ts
// app/api/people/route.ts
export async function GET(request: Request) {
    const people = await db.withSignal(request.signal).select<Person>(personTable);

    return Response.json(people);
}
```

**Hono**:

```ts
app.get("/people", async (c) => {
    const people = await db.withSignal(c.req.raw.signal).select<Person>(personTable);

    return c.json(people);
});
```

**Express**, where the request has no signal, so make one from the response closing:

```ts
app.get("/people", async (req, res, next) => {
    const controller = new AbortController();

    // `res` closes when the response is over. If it closes before it was finished, the client went away.
    res.on("close", () => {
        if (!res.writableFinished) controller.abort();
    });

    try {
        const people = await db.withSignal(controller.signal).select<Person>(personTable);
        res.json(people);
    } catch (error) {
        // Nobody is left to answer when the client went away
        if (!controller.signal.aborted) next(error);
    }
});
```

Listen on `res` rather than `req` here: on current versions of Node.js the `close` event of a request which has a body fires as soon as that body has been read, which is long before the client could go away.

Whether, and when, the signal of a request aborts depends on the platform running your handler. Consult its documentation for the conditions under which it does.

#### Live queries in a request handler

A live query which outlives the request that started it leaks on the server, so `live()` and `liveOf()` subscriptions made through a view are **killed when its signal aborts**. Aborting is the normal end of a live stream, and not a failure: iteration ends cleanly instead of throwing the reason, `isAlive` turns false immediately, and the live query is killed on the server. That makes a server sent events handler short:

```ts
export async function GET(request: Request) {
    const subscription = await db.withSignal(request.signal).live<Person>(personTable);
    const encoder = new TextEncoder();

    return new Response(
        new ReadableStream({
            async start(controller) {
                for await (const change of subscription) {
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(change)}\n\n`));
                }

                // The client went away: the subscription is already dead and killed
                controller.close();
            },
        }),
        { headers: { "Content-Type": "text/event-stream" } },
    );
}
```

- A signal which has already aborted makes `live()` reject with its reason, and registers no live query.
- If it aborts while the live query is being registered, `live()` rejects with the reason, and the live query which the server registers in the meantime is killed as soon as it lands.
- Calling `kill()` yourself afterwards, for example from a `finally` block, is fine: killing a subscription more than once is a no-op.
- `liveOf(id)` behaves the same, and kills the live query with that id, as `kill()` does. If the signal had aborted already it subscribes to nothing, and leaves the live query alone.
- A failure to kill the live query is reported on the connection's `error` event, unless it is only that the connection is gone, which takes the live query with it.

When the connection [resolves credentials for each request](#resolving-credentials-for-each-request), registering a live query is a request like any other, and waits for the credential of the session first:

- Aborting the signal during that wait rejects `live()` with its reason at once and sends nothing: no live query is registered, nothing needs killing, and giving up is not reported as a failure of the connection. Once the registration is on its way it is not abandoned, as its answer is the only thing which says what the server registered; aborting then ends the live query when it lands, as above. A resolution which was queued behind another and has not begun when the signal aborts does not begin.
- A live query has no `.as()`. It is registered on the session, and killed as the session, so a `live()` call is not made as someone else, over HTTP or otherwise, and live queries need a WebSocket connection to begin with.
- A subscription which is running is not affected by credentials being resolved for the requests which follow it, nor by a credential which expired being resolved again: the session takes the new one, and the subscription goes on delivering, until its signal aborts or it is killed. Nothing is renewed in the background for it. After a reconnection it is registered again, once the credential has been resolved for that request.

#### Import and export

`import()`, `export()` and `exportModel()` take a signal as well, with the same meaning, and so do the views made by `withSignal()`:

```ts
// Stop an export when the request which asked for it goes away
const sql = await db.export().signal(request.signal);

// Stop uploading a stream. The stream is cancelled with the reason of the signal
await db.import(stream).signal(AbortSignal.timeout(60_000));

// A raw export keeps being governed by the signal while its body is read
const response = await db.export().raw().signal(request.signal);
```

An export which is abandoned has its response stream cancelled, and an import which is abandoned cancels the stream it was uploading, so nothing keeps downloading or reading. As elsewhere, **the server may carry on**: an import which had been received in full may or may not have been applied.

The `requestTimeout` of the connection does **not** apply to them, as imports and exports are long running and streamed, and a limit meant for queries would cut them short. `.requestTimeout(ms)` on the call sets a limit for the whole transfer when you want one.

Like the other query methods, `import()` does nothing until it is awaited.

They present the credential of the connection like every other request, including one which is [resolved for each request](#resolving-credentials-for-each-request), and they are abandoned at every wait, the wait for that credential among them: a call which is abandoned while its credential is being resolved, or exchanged for a token, rejects at once with the reason of the signal, nothing is sent, and a stream which was to be uploaded is cancelled with the reason rather than left open. A stream is uploaded once and cannot be uploaded again, so when the server answers an import of one with a `401` for its credential, the import fails with it instead of being sent again with a renewed credential, as an export, or an import of a string or a `Blob`, is.

Over HTTP they can also be run as someone else, like a query, with `.as()`. See [running a call as someone else](#running-a-call-as-someone-else).

#### Failed import statements

An import is not transactional: each statement applies on its own, and one which fails does not stop the rest. Over HTTP and WebSocket, SurrealDB 3.1 and later answer an import with the statements which failed, and `import()` rejects with an `ImportError` listing them:

```ts
try {
    await db.import(file);
} catch (error) {
    if (error instanceof ImportError) {
        console.log(`${error.failed} statements failed, the first with: ${error.failures[0]?.message}`);
    }
}
```

`failures` holds the first hundred as `ServerError`s, such as an `AlreadyExistsError`, and `failed` counts all of them. The answer lists only the statements which failed, so it is read whole: it is small unless very many statements failed. Older servers answer with the result of every statement, so the answer is not read and failed statements are not reported, and embedded engines report what their engine does.

#### Import and export progress

SurrealDB reports no progress for an import or an export, so the SDK counts the bytes as they go. Pass a callback to `.progress()` to be told how far along a transfer is:

```ts
await db.import(file).progress(({ loaded, total }) => {
    console.log(`Uploaded ${loaded} of ${total} bytes`);
});

const sql = await db.export().progress(({ loaded }) => {
    console.log(`Received ${loaded} bytes`);
});
```

- An import reports the bytes uploaded so far. The server executes an import as it reads it, so this stays close behind what has been applied, and the import still waits for the last statements once the upload completes. The `total` is known for a string or a `Blob`, and not for a stream.
- In a browser, `fetch` cannot report the upload of a string or a `Blob`, so that upload goes through `XMLHttpRequest` instead. This is skipped on a connection with a `fetchImpl`, or one which [resolves credentials for each request](#resolving-credentials-for-each-request), and progress is not reported for those.
- Embedded engines apply an import in a single call and report no progress for it.
- Nothing is held in memory to report progress: uploads and raw exports stay streamed.
- An export reports the bytes received so far. The server streams it without a length, so the `total` is not known. A raw export reports what has been read of its body. `exportModel()` reports the same way.

#### Runtimes

`AbortSignal.any()` and `AbortSignal.timeout()` are used where the runtime has them, and replaced by an equivalent where it does not, such as in React Native. A signal whose `reason` the runtime does not record is reported as an `AbortError`.

#### Customising `fetch`

The HTTP engine makes its requests with the global `fetch`, or the `fetchImpl` you give the driver, which replaces it altogether. To only add to every request, pass `fetchOptions`, which are merged into the `init` of each `fetch` call. The `method`, `headers`, `body` and `signal` of a request belong to the SDK and cannot be set this way.

```ts
const db = new Surreal({
    fetchOptions: { cache: "no-store", priority: "high" },
});
```

### Next steps

We have only scratched the surface of what the JavaScript SDK can do. For more information, please refer to the [documentation](https://surrealdb.com/docs/sdk/javascript).

## Embedding SurrealDB in the browser

The [**`@surrealdb/wasm`**](https://github.com/surrealdb/surrealdb.js/blob/main/packages/wasm/README.md) engine plugin runs SurrealDB inside a browser - in-memory or persisted to IndexedDB. See the [WebAssembly engine readme](https://github.com/surrealdb/surrealdb.js/blob/main/packages/wasm/README.md) for worker setup, Vite configuration, and full package details.

```sh
npm i @surrealdb/wasm
```

```ts
import { createWasmEngines } from "@surrealdb/wasm";
import { Surreal, createRemoteEngines } from "surrealdb";

const db = new Surreal({
    engines: {
        ...createRemoteEngines(),
        ...createWasmEngines(),
    },
});

await db.connect("mem://");
await db.connect("indxdb://demo");
```

When using [Vite](https://vitejs.dev/), exclude the WASM package from dependency optimisation and enable top-level await:

```js
optimizeDeps: {
    exclude: ["@surrealdb/wasm"],
    esbuildOptions: {
        target: "esnext",
    },
},
esbuild: {
    supported: {
        "top-level-await": true,
    },
},
```

## Embedding SurrealDB in Node.js, Deno, and Bun

The [**`@surrealdb/node`**](https://github.com/surrealdb/surrealdb.js/blob/main/packages/node/README.md) engine plugin embeds SurrealDB in Node.js, Bun, or Deno - in-memory or persisted to disk via RocksDB or SurrealKV. See the [Node.js engine readme](https://github.com/surrealdb/surrealdb.js/blob/main/packages/node/README.md) for connection options and shutdown behaviour.

```sh
npm i @surrealdb/node
```

```ts
import { createNodeEngines } from "@surrealdb/node";
import { Surreal, createRemoteEngines } from "surrealdb";

const db = new Surreal({
    engines: {
        ...createRemoteEngines(),
        ...createNodeEngines(),
    },
});

await db.connect("mem://");
await db.connect("rocksdb://path/to/storage.db");
await db.connect("surrealkv://path/to/storage.db");
await db.connect("surrealkv+versioned://path/to/storage.db");
```

When using the embedded engine, call `.close()` when you are done to shut down the database cleanly.

## Package contents

| Area | Key exports |
| --- | --- |
| Client | `Surreal`, `SurrealSession`, `SurrealTransaction` |
| Query API | `.query()`, `.gql()`, `.select()`, `.create()`, `.update()`, `.delete()`, `.insert()`, `.upsert()`, `.relate()`, `.live()`, `.signal()`, `.requestTimeout()`, `.withSignal()` |
| Remote engines | `createRemoteEngines()`, `WebSocketEngine`, `HttpEngine` |
| Bound queries | `surql`, `BoundQuery`, `expr`, comparison and logical operators |
| Value types | `RecordId`, `Table`, `DateTime`, `Decimal`, `Uuid`, and more (from `@surrealdb/sqon`) |
| Codecs | `CborCodec`, `JsonCodec`, `CodecOptions` (from `@surrealdb/sqon`) |
| Utilities | `equals`, `jsonify`, `escapeIdent`, `s`, `d`, `r`, `u` string prefixes |
| Errors | SDK error classes and `parseRpcError` for RPC failures |

## Supported environments

- [Node.js](https://nodejs.org)
- [Bun](https://bun.sh)
- [Deno](https://deno.land)
- Web browsers

ES modules (`import`) are supported. Node.js builds also expose a CommonJS entry point.

### TypeScript

This SDK supports both TypeScript 5 and TypeScript 6. If you are using TypeScript 6, note that the default value for the `types` compiler option changed from auto-discovering all `@types/*` packages to `[]`. You may need to explicitly add the types you depend on in your `tsconfig.json`:

```json
{
    "compilerOptions": {
        "types": ["node"]
    }
}
```

## Learn more

- [SDK documentation](https://surrealdb.com/docs/sdk/javascript)
- [Connecting to SurrealDB](https://surrealdb.com/docs/languages/javascript/concepts/connecting-to-surrealdb)
- [Executing queries](https://surrealdb.com/docs/languages/javascript/concepts/executing-queries)
- [Value types](https://surrealdb.com/docs/languages/javascript/concepts/value-types)
- [Codecs](https://surrealdb.com/docs/languages/javascript/concepts/codecs)
- [Embedded engines](https://surrealdb.com/docs/languages/javascript/concepts/embedded-engines)

## Contributing

This package is part of the [surrealdb.js](https://github.com/surrealdb/surrealdb.js) monorepo. See the [main README](https://github.com/surrealdb/surrealdb.js/blob/main/README.md) for local setup, build commands, and contribution guidelines.
