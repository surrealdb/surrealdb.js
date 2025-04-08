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

- SurrealDB University: https://surrealdb.com/learn/fundamentals
- Aeon's Surreal Renaissance (Interative book): https://surrealdb.com/learn/book
- Documentation: https://surrealdb.com/docs

## How to install

### Install for [JSR/Deno](https://jsr.io/@surrealdb/surrealdb)

Import it with:

```ts
import Surreal from "@surrealdb/surrealdb";
```

### Install for [Node.js](https://www.npmjs.com/package/surrealdb)

Install it with:

```sh
# using npm
npm i surrealdb
# or using pnpm
pnpm i surrealdb
# or using yarn
yarn add surrealdb
```

Next, just import it with:

```ts
const { Surreal } = require("surrealdb");
```

or when you use modules:

```ts
import Surreal from "surrealdb";
```

### Install for the browser

For usage in a browser environment, when using a bundler (e.g. [Rollup](https://rollupjs.org/), [Vite](https://vitejs.dev/), or [webpack](https://webpack.js.org/)) you can install it with:

```sh
# using npm
npm i surrealdb
# or using pnpm
pnpm i surrealdb
# or using yarn
yarn add surrealdb
```

Next, just import it with:

```ts
import Surreal from "surrealdb";
```

or when you use CommonJS:

```ts
const { Surreal } = require("surrealdb");
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

> This example requires SurrealDB to be [installed](https://surrealdb.com/install) and running on port 8000.

> This example makes use of [top level await](https://v8.dev/features/top-level-await), available in [modern browsers](https://caniuse.com/mdn-javascript_operators_await_top_level), [Deno](https://deno.com/) and [Node.js](https://nodejs.org/) >= 14.8.

```ts
import { Surreal, RecordId, Table } from "surrealdb";

const db = new Surreal();

// Connect to the database
await db.connect("http://127.0.0.1:8000/rpc");

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
let created = await db.create("person", {
    title: "Founder & CEO",
    name: {
        first: "Tobie",
        last: "Morgan Hitchcock",
    },
    marketing: true,
});

// Update a person record with a specific id
let updated = await db.merge(new RecordId('person', 'jaime'), {
    marketing: true,
});

// Select all people records
let people = await db.select("person");

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

`bun qa`

### Code Quality unsafe fixes

`bun qau`

### Run tests for WS

`bun test`

### Run tests for HTTP

`SURREAL_PROTOCOL=http bun test`

### PRs

Before you commit, please format and lint your code accordingly to check for
errors, and ensure all tests still pass

### Local setup

For local development the
[Bun extension](https://marketplace.visualstudio.com/items?itemName=oven.bun-vscode) and [Biome extension](https://marketplace.visualstudio.com/items?itemName=biomejs.biome)
for VSCode are helpful.

### Directory structure

- `./biome.json` include settings for code quality.
- `./scripts` include the build scripts for NPM and JSR.
- `./src` includes all source code. `./src/index.ts` is the main entrypoint.
- `./dist` is build by `./scripts/build.ts` and includes the compiled and minified bundles for ESM, CJS and bundled ESM targets.
- `./tests` includes all test files.
