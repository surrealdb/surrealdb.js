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
| Query API | `.query()`, `.select()`, `.create()`, `.update()`, `.delete()`, `.insert()`, `.upsert()`, `.relate()`, `.live()` |
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
