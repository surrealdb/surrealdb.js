# surrealdb.js

The official SurrealDB library for JavaScript.

[![](https://img.shields.io/badge/status-beta-ff00bb.svg?style=flat-square)](https://github.com/surrealdb/surrealdb.js) [![](https://img.shields.io/badge/docs-view-44cc11.svg?style=flat-square)](https://surrealdb.com/docs/integration/libraries/javascript) [![](https://img.shields.io/badge/license-Apache_License_2.0-00bfff.svg?style=flat-square)](https://github.com/surrealdb/surrealdb.js)

## Install

### Deno
Import it with

```ts
import Surreal from 'https://deno.land/x/surrealdb/mod.ts';
```

### NodeJS, Browser with bundler
For NodeJS or Browser with bundler like rollup, vite, webpack, ... you can just install the npm package:

```sh
npm i surrealdb.js
# or with yarn
yarn add surrealdb.js
# or with pnpm
pnpm i surrealdb.js
```

just import it with 

```ts
import Surreal from 'surrealdb.js';
```

or when you use commonjs

```ts
const Surreal = require('surrealdb.js')
```

### CDN for Browser
For fast prototyping we provide a browser-ready bundle. You can import it with
```ts
import Surreal from "https://unpkg.com/surrealdb.js";
// or
import Surreal from "https://cdn.jsdelivr.net/npm/surrealdb.js";
```

*** NOTE: this bundle is not optimized for production! So don't use it in production!***

## Getting started

```ts
const db = new Surreal('http://127.0.0.1:8000/rpc');

async function main() {

	try {

		// Signin as a namespace, database, or root user
		await db.signin({
			user: 'root',
			pass: 'root',
		});

		// Select a specific namespace / database
		await db.use('test', 'test');

		// Create a new person with a random id
		let created = await db.create("person", {
			title: 'Founder & CEO',
			name: {
				first: 'Tobie',
				last: 'Morgan Hitchcock',
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
		let groups = await db.query('SELECT marketing, count() FROM type::table($tb) GROUP BY marketing', {
			tb: 'person',
		});

	} catch (e) {

		console.error('ERROR', e);

	}

}

main();
```

## More informations
The docs of this libary are located at [https://surrealdb.com/docs/integration/libraries/nodejs](https://surrealdb.com/docs/integration/libraries/nodejs)