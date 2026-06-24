<br>

<p align="center">
    <img width=120 src="https://raw.githubusercontent.com/surrealdb/icons/main/surreal.svg" />
</p>

<h1 align="center">@surrealdb/wasm</h1><br/>
<p align="center">Embedded SurrealDB engine for the browser</p>

<br>

<p align="center">
    <img width=74 src="https://raw.githubusercontent.com/surrealdb/icons/main/webassembly.svg" />
</p>

<br>

<p align="center">
    <a href="https://github.com/surrealdb/surrealdb.js"><img src="https://img.shields.io/badge/status-stable-ff00bb.svg?style=flat-square"></a>
    &nbsp;
    <a href="https://surrealdb.com/docs/sdk/javascript"><img src="https://img.shields.io/badge/docs-view-44cc11.svg?style=flat-square"></a>
    &nbsp;
    <a href="https://www.npmjs.com/package/@surrealdb/wasm"><img src="https://img.shields.io/npm/v/@surrealdb/wasm?style=flat-square"></a>
</p>

<p align="center">
    <a href="https://surrealdb.com/discord"><img src="https://img.shields.io/discord/902568124350599239?label=discord&style=flat-square&color=5a66f6"></a>
    &nbsp;
    <a href="https://twitter.com/surrealdb"><img src="https://img.shields.io/badge/twitter-follow_us-1d9bf0.svg?style=flat-square"></a>
    &nbsp;
    <a href="https://www.linkedin.com/company/surrealdb/"><img src="https://img.shields.io/badge/linkedin-connect_with_us-0a66c2.svg?style=flat-square"></a>
</p>

## Documentation

View the JavaScript SDK documentation [here](https://surrealdb.com/docs/sdk/javascript), including the [embedded engines](https://surrealdb.com/docs/languages/javascript/concepts/embedded-engines) concept page and the [WebAssembly engine reference](https://surrealdb.com/docs/languages/javascript/engines/wasm).

## What is this package?

**`@surrealdb/wasm`** is a WebAssembly engine plugin for the SurrealDB JavaScript SDK. It runs SurrealDB inside the browser - in-memory or persisted to IndexedDB - with the same query API as a remote instance.

Install it alongside [`surrealdb`](https://www.npmjs.com/package/surrealdb) and register the engine when constructing your client. For server-side embedding, use [`@surrealdb/node`](https://www.npmjs.com/package/@surrealdb/node) instead.

## How to install

This package has a peer dependency on `surrealdb`. Install both:

```sh
# using npm
npm i surrealdb @surrealdb/wasm

# or using pnpm
pnpm i surrealdb @surrealdb/wasm

# or using yarn
yarn add surrealdb @surrealdb/wasm

# or using bun
bun add surrealdb @surrealdb/wasm
```

## Getting started

Register the WebAssembly engine when you create a `Surreal` client, then connect to an embedded endpoint:

```ts
import { createWasmEngines } from "@surrealdb/wasm";
import { Surreal } from "surrealdb";

const db = new Surreal({
    engines: createWasmEngines(),
});

await db.connect("mem://");

await db.use({ namespace: "test", database: "test" });

await db.query("CREATE person SET name = 'Tobie'");
```

To connect to remote SurrealDB instances as well as embedded databases, combine the WebAssembly engine with the SDK's remote engines:

```ts
import { createWasmEngines } from "@surrealdb/wasm";
import { Surreal, createRemoteEngines } from "surrealdb";

const db = new Surreal({
    engines: {
        ...createRemoteEngines(),
        ...createWasmEngines(),
    },
});
```

### Storage backends

```ts
// In-memory (data is lost when the tab closes)
await db.connect("mem://");

// IndexedDB persistence
await db.connect("indxdb://myapp");
```

### Running in a Web Worker

Offload database work from the main thread to keep your UI responsive:

```ts
import { createWasmWorkerEngines } from "@surrealdb/wasm";
import WorkerAgent from "@surrealdb/wasm/worker?worker";
import { Surreal, createRemoteEngines } from "surrealdb";

const db = new Surreal({
    engines: {
        ...createRemoteEngines(),
        ...createWasmWorkerEngines({
            createWorker: () => new WorkerAgent(),
        }),
    },
});

await db.connect("mem://");
```

The `@surrealdb/wasm/worker` export provides a pre-built worker script for bundlers that support the `?worker` import suffix (such as Vite).

### Connection options

Pass optional engine configuration to `createWasmEngines` or `createWasmWorkerEngines`:

```ts
const db = new Surreal({
    engines: createWasmEngines({
        strict: true,
        query_timeout: 30_000,
    }),
});
```

## Usage with Vite

When using [Vite](https://vitejs.dev/), exclude the WASM package from dependency optimisation and enable top-level await:

```js
// vite.config.js
export default {
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
};
```

## Package contents

| Export | Description |
| --- | --- |
| `createWasmEngines(options?)` | Registers `mem` and `indxdb` engines on the main thread |
| `createWasmWorkerEngines(options?)` | Registers `mem` and `indxdb` engines inside a Web Worker |
| `@surrealdb/wasm/worker` | Worker entry point for bundler worker imports |
| `WebAssemblyEngine` | The underlying engine implementation (advanced use) |

## Requirements

- ES modules (`import`) - CommonJS (`require`) is not supported
- A compatible `surrealdb` SDK version (see `peerDependencies` in `package.json`)
- A modern browser with WebAssembly and IndexedDB support

## Contributing

This package is part of the [surrealdb.js](https://github.com/surrealdb/surrealdb.js) monorepo. See the [main README](https://github.com/surrealdb/surrealdb.js/blob/main/README.md) for local setup, build commands, and contribution guidelines.
