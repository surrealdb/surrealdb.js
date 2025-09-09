<br>

<p align="center">
    <img width=120 src="https://raw.githubusercontent.com/surrealdb/icons/main/surreal.svg" />
    &nbsp;
    <img width=120 src="https://raw.githubusercontent.com/surrealdb/icons/main/javascript.svg" />
</p>

<h3 align="center">The official SurrealDB SDK for JavaScript.</h3>

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

# surrealdb

The official SurrealDB SDK for JavaScript.

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

_**NOTE: this bundle is not optimized for production! So don't use it in production!**_

## Getting started

In the example below you can see how to connect to a remote instance of SurrealDB, authenticating with the database, and issuing queries for creating, updating, and selecting data from records.

### Don't have a SurrealDB instance yet?

If you don't already have a SurrealDB instance running, you can easily get started by using Surreal Cloud. Simply [sign up here](https://app.surrealdb.com/signin/deploy) to provision a free SurrealDB instance in the cloud. This will allow you to experiment with SurrealDB without any local setup, and you'll be able to connect to your new instance right away.

### Example

```ts
import { Surreal, RecordId, Table } from "surrealdb";

const db = new Surreal();

// Connect to the database
await db.connect("wss://my-instance.aws-euw1.surreal.cloud");

// Select a specific namespace / database
await db.use({
    namespace: "test",
    database: "test"
});

// Signin as a namespace, database, or root user
await db.signin({
    username: "root",
    password: "root",
});

// Create a new person with a random id
const personTable = new Table("person");

let created = await db.create(personTable, {
    title: "Founder & CEO",
    name: {
        first: "Tobie",
        last: "Morgan Hitchcock",
    },
    marketing: true,
});

// Update a person record with a specific id
const personJaime = new RecordId('person', 'jaime');

let updated = await db.merge(personJaime, {
    marketing: true,
});

// Select all people records
let people = await db.select(personTable);

// Perform a custom advanced query
let groups = await db.query(
    "SELECT marketing, count() FROM $tb GROUP BY marketing",
    {
        tb: new Table("person"),
    },
);
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
