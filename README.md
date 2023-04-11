# surrealdb.js

The official SurrealDB library for JavaScript.

[![npm version](https://badge.fury.io/js/surrealdb.js.svg)](https://badge.fury.io/js/surrealdb.js)
[![deno module](https://shield.deno.dev/x/surrealdb)](https://deno.land/x/surrealdb)

[![](https://img.shields.io/badge/status-beta-ff00bb.svg?style=flat-square)](https://github.com/surrealdb/surrealdb.js)
[![](https://img.shields.io/badge/docs-view-44cc11.svg?style=flat-square)](https://surrealdb.com/docs/integration/libraries/javascript)
[![](https://img.shields.io/badge/license-Apache_License_2.0-00bfff.svg?style=flat-square)](https://github.com/surrealdb/surrealdb.js)

## Quickstart-Guide

### Install

#### Deno

Import it with

```ts
import Surreal from "https://deno.land/x/surrealdb/mod.ts";
```

> Note you should set a version in the url! For example
> `https://deno.land/x/surrealdb@0.5.0/mod.ts`

#### NodeJS, or browser with a bundler

For NodeJS or a browser with bundler (for example: rollup, vite, or webpack) you can just:
install the npm package:

```sh
npm i surrealdb.js
# or with yarn
yarn add surrealdb.js
# or with pnpm
pnpm i surrealdb.js
```

then, just import it with:

```ts
import Surreal from "surrealdb.js";
```

or when you use CommonJS

```ts
const { default: Surreal } = require("surrealdb.js");
```

#### CDN for Browser

For fast prototyping we provide a browser-ready bundle. You can import it with

```ts
import Surreal from "https://unpkg.com/surrealdb.js";
// or
import Surreal from "https://cdn.jsdelivr.net/npm/surrealdb.js";
```

_**NOTE: this bundle is not optimized for production! So don't use it in
production!**_

### Getting started

Here you have a simple example!

> This example uses top level await wich is available in deno, node >= 14.8,
> modern browsers
> (https://caniuse.com/mdn-javascript_operators_await_top_level).

```ts
const db = new Surreal("http://127.0.0.1:8000/rpc");

try {
	// Signin as a namespace, database, or root user
	await db.signin({
		user: "root",
		pass: "root",
	});

	// Select a specific namespace / database
	await db.use("test", "test");

	// Create a new person with a random id
	let created = await db.create("person", {
		title: "Founder & CEO",
		name: {
			first: "Tobie",
			last: "Morgan Hitchcock",
		},
		marketing: true,
		identifier: Math.random().toString(36).substr(2, 10),
	});

	// Update a person record with a specific id
	let updated = await db.change("person:jaime", {
		marketing: true,
	});

	// Select all people records
	let people = await db.select("person");

	// Perform a custom advanced query
	let groups = await db.query(
		"SELECT marketing, count() FROM type::table($tb) GROUP BY marketing",
		{
			tb: "person",
		},
	);
} catch (e) {
	console.error("ERROR", e);
}
```

## More informations

The docs of this libary are located at
[https://surrealdb.com/docs/integration/libraries/javascript](https://surrealdb.com/docs/integration/libraries/javascript)

## Contribution notes

### Local setup

This is a [Deno](https://deno.land) project, not NodeJS. For example, this means
import paths include the `.ts` file extension. However, to also support other
JavaScript environments, a build has been added to create a npm package that
works for NodeJS, Bun, browsers with bundlers.

#### Supported environments

- [Deno](https://deno.land)
- [NodeJS](https://nodejs.org)
- [Bun](https://bun.sh)
- Web Browsers

### Requirements

- Deno
- npm
- NodeJS
- Docker (for e2e tests)
- Bun (for e2e tests)

### Build for all supported environments

For Deno, no build is needed. For all other environments run

`deno task build`.

### Formatting

`deno fmt`

### Linting

`deno lint`

### PRs

Before you commit, please format and lint your code accordingly to check for
errors.

### Local setup

For local development the
[Deno extension](https://marketplace.visualstudio.com/items?itemName=denoland.vscode-deno)
for VSCode is helpful (hint: local Deno installation required).

### Directory structure

- `./mod.ts` is the deno entypoint. This is just a reexport of `./src/index.ts`
- `./deno.json` include settings for linting + formating.
- `./compile.ts` include the build script for the npm package.
- `./src` includes all source code. `./src/index.ts` is the main entrypoint.
- `./npm` is build by `./compile.ts` and includes the generated npm package.
- `./test` includes all test files. To add a test modify `./test/e2e/shared.js`.
