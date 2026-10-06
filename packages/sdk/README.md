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

### Sending queries

After you have connected to a SurrealDB instance, you can send queries to the database. Queries can be sent in two ways:

- Type-safe using the query builder methods
- As a string using the `query` method

#### Type-safe query builders

```ts
const personTable = new Table("person");

// Create a new person with a random id
let created = await db.create<Person>(personTable, {
    title: "Founder & CEO",
    name: {
        first: "Tobie",
        last: "Morgan Hitchcock",
    },
    marketing: false,
});

// Update a person record with a specific id
let updated = await db.update<Person>(created.id).merge({
    marketing: true,
});

// Select all people records
let people = await db.select<Person>(personTable);
```

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

A query which takes longer fails with the `TimeoutError` of `AbortSignal.timeout()`. The limit applies to each request separately, so a query which is retried gets the full time for every attempt. It starts when the request is sent, and does not include the time spent waiting for a connection; to bound the whole of an operation, including retries, pass `AbortSignal.timeout()` to `.signal()` instead. It applies to queries, which includes a list of queries and an atomic `transaction()`, and not to signing in, selecting a namespace, the `begin` and `commit` of an interactive transaction, import or export.

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
- `.signal()` and `.requestTimeout()` on the items of a list are ignored, like anything else configured on them: abandon the combined query, or call it on a view made with `withSignal()`.

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

The view is a cheap object (a `SurrealRequestScope`) which shares the connection and the session it was made from and does not change them, so make one for every request on a connection which is shared by all of them. It can be made from a session (`db`, or one from `forkSession()`), and from a transaction. Only queries are bound to the signal. **`live()` and `liveOf()` subscriptions made through a view are not bound to it**: they are not killed when the signal aborts and keep running until you kill them or the connection closes, so a handler which subscribes has to kill the subscription itself, for example with `signal.addEventListener("abort", () => subscription.kill())`. Nor is the `commit()` of a transaction, so that abandoning a request can never leave the outcome of a commit in doubt.

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
