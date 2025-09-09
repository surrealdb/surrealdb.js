<br>

<p align="center">
    <img width=120 src="https://raw.githubusercontent.com/surrealdb/icons/main/surreal.svg" />
</p>

<div id="toc">
    <ul align="center" style="list-style: none;">
        <summary>
            <h1 align="center">SurrealDB JavaScript SDK</h1><br/>
            <p align="center">Connect to remote and embedded SurrealDB instances</p>
        </summary>
    </ul>
</div>

<br>

<p align="center">
    <img width=74 src="https://raw.githubusercontent.com/surrealdb/icons/main/javascript.svg" />
	&nbsp;
	<img width=74 src="https://raw.githubusercontent.com/surrealdb/icons/main/webassembly.svg" />
	&nbsp;
	<img width=74 src="https://raw.githubusercontent.com/surrealdb/icons/main/nodejs.svg" />
<br>

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

> [!WARNING]
> This readme describes the v2 SDK which is currently not stable and subject to change. For the stable v1 SDK, see [here](https://github.com/surrealdb/surrealdb.js/blob/main/README.md).

## Documentation

View the SDK documentation [here](https://surrealdb.com/docs/sdk/javascript).

## Learn SurrealDB

- A Tour of SurrealDB: https://surrealdb.com/learn/tour
- Aeon's Surreal Renaissance (Interative book): https://surrealdb.com/learn/book
- Documentation: https://surrealdb.com/docs

## How to install

### Install with a package manager

Run the following command to add the SDK to your project:

```sh
# using npm
npm i surrealdb@alpha

# or using pnpm
pnpm i surrealdb@alpha

# or using yarn
yarn add surrealdb@alpha

# or using bun
bun add surrealdb@alpha
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

_**NOTE: this bundle is not optimized for production! So don't use it in production!**_

## Getting started

In the example below you can see how to connect to a remote instance of SurrealDB, authenticating with the database, and issuing queries for creating, updating, and selecting data from records.

### Don't have a SurrealDB instance yet?

If you don't already have a SurrealDB instance running, you can easily get started by using Surreal Cloud. Simply [sign up here](https://app.surrealdb.com/signin/deploy) to provision a free SurrealDB instance in the cloud. This will allow you to experiment with SurrealDB without any local setup, and you'll be able to connect to your new instance right away.

### Connecting

The first step in using the SDK is to instantiate the SurrealDB client, after which you can connect to a SurrealDB instance using a connection URI. After that, select a namespace and database, and signin as a namespace, database, root, or record user.

Make sure you have created a user before you signin.

```ts
import { Surreal, RecordId, Table } from "surrealdb";

// Instantiate the SurrealDB client
const db = new Surreal();

// Connect to the specified instance
await db.connect("wss://my-instance.aws-euw1.surreal.cloud");

// Select a specific namespace / database
await db.use({
    namespace: "test",
    database: "test"
});

// Signin as a namespace, database, root, or record user
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
	query("CREATE ONLY $table CONTENT $content", {
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

### Subscriving to live queries

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

The SurrealDB JavaScript SDK can be extended with the WebAssembly engine to run an embedded version of SurrealDB directly in the browser. This allows you to run SurrealDB in-memory or persisted to IndexedDB with minimal effort.

```ts
import { createWasmEngines } from "@surrealdb/wasm";
import { Surreal } from "surrealdb";

// Register the WebAssembly engine
const db = new Surreal({
	engines: createWasmEngines(),
});

// Connect to an in-memory instance
await db.connect("mem://");

// Connect to an IndexedDB instance
await db.connect("indxdb://demo");
```

### Usage with Vite

When using [Vite](https://vitejs.dev/) the following configuration is recommended to be placed in your `vite.config.ts` to ensure the WebAssembly engine is properly bundled.

```js
optimizeDeps: {
    exclude: ["@surrealdb/wasm"],
    esbuildOptions: {
        target: "esnext",
    },
},
esbuild: {
    supported: {
        "top-level-await": true
    },
}
```

## Embedding SurrealDB in Node.js, Deno, and Bun

The SurrealDB JavaScript SDK can be extended with the Node.js engine to run an embedded version of SurrealDB directly in your Node.js, Deno, or Bun runtime. This allows you to run SurrealDB in-memory or persisted to disk (RocksDB or SurrealKV) with minimal effort.

```ts
import { createNodeEngines } from "@surrealdb/node";
import { Surreal } from "surrealdb";

// Register the Node.js engine
const db = new Surreal({
	engines: createNodeEngines(),
});

// Connect to an in-memory instance
await db.connect("mem://");

// Connect to an RocksDB instance
await db.connect("rocksdb://path/to/storage.db");

// Connect to an SurrealKV instance
await db.connect("surrealkv://path/to/storage.db");

// Connect to an SurrealKV instance with versioning
await db.connect("surrealkv+versioned://path/to/storage.db");
```

## Contributing

### Local setup

This is a [Bun](https://bun.sh) project, not Node.js. It works across all major runtimes, however.

#### Supported environments

- [Deno](https://deno.land)
- [Node.js](https://nodejs.org)
- [Bun](https://bun.sh)
- Web Browsers

### Requirements

- Bun
- SurrealDB (for testing)

### Build for all supported environments

For Deno, no build is needed. For all other environments run

`bun run build`.

### Code Quality Fixes

`bun run qa`

### Code Quality unsafe fixes

`bun run qau`

### Run tests for WS

`bun run test`

### Run tests for HTTP

`SURREAL_DEFAULT_PROTOCOL=http bun test`

### PRs

Before you commit, please format and lint your code accordingly to check for
errors, and ensure all tests still pass

### Local setup

For local development the
[Bun extension](https://marketplace.visualstudio.com/items?itemName=oven.bun-vscode) and [Biome extension](https://marketplace.visualstudio.com/items?itemName=biomejs.biome)
for VSCode are helpful.

### Directory structure

- `./biome.json` contains settings for code quality.
- `./scripts` contains the build and publish scripts.
- `./packages/sdk` contains the JavaScript SDK source code.
- `./packages/node` contains the Node.js SDK source code.
- `./packages/wasm` contains the WebAssembly SDK source code.
- `./packages/tests` contains the testing suite.
- `./demo/wasm` contains a WebAssembly demo.
- `./demo/node` contains a Node.js demo.
