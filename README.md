<br>

<p align="center">
    <img width=120 src="https://raw.githubusercontent.com/surrealdb/icons/main/surreal.svg" />
</p>

<h1 align="center">SurrealDB JavaScript SDK</h1><br/>
<p align="center">Connect to remote and embedded SurrealDB instances</p>

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

## Packages

This monorepo publishes several npm packages. Most applications only need **`surrealdb`** - install engine or utility packages when your use case requires them.

| Package | npm | Description | Readme |
| --- | --- | --- | --- |
| **`surrealdb`** | [`surrealdb`](https://www.npmjs.com/package/surrealdb) | Official database client - connect, query, live subscriptions, sessions | [Read more](./packages/sdk/README.md) |
| **`@surrealdb/sqon`** | [`@surrealdb/sqon`](https://www.npmjs.com/package/@surrealdb/sqon) | Value types, CBOR/JSON codecs, and core utilities (re-exported by `surrealdb`) | [Read more](./packages/sqon/README.md) |
| **`@surrealdb/wasm`** | [`@surrealdb/wasm`](https://www.npmjs.com/package/@surrealdb/wasm) | Embedded SurrealDB engine for browsers (`mem://`, `indxdb://`) | [Read more](./packages/wasm/README.md) |
| **`@surrealdb/node`** | [`@surrealdb/node`](https://www.npmjs.com/package/@surrealdb/node) | Embedded SurrealDB engine for Node.js, Bun, and Deno | [Read more](./packages/node/README.md) |
| **`@surrealdb/spectron`** | [`@surrealdb/spectron`](https://www.npmjs.com/package/@surrealdb/spectron) | Typed HTTP client for the Spectron AI memory API | [Read more](./packages/spectron/README.md) |

### Quick start

```sh
bun add surrealdb
```

```ts
import { Surreal } from "surrealdb";

const db = new Surreal();
await db.connect("wss://my-instance.aws-euw1.surreal.cloud");
```

For installation options, connection setup, query examples, live queries, embedded engines, and TypeScript notes, see the [**`surrealdb` package readme**](./packages/sdk/README.md).

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

### TypeScript

This SDK supports both TypeScript 5 and TypeScript 6. If you are using TypeScript 6, note that the default value for the `types` compiler option changed from auto-discovering all `@types/*` packages to `[]`. You may need to explicitly add the types you depend on in your `tsconfig.json`:

```json
{
    "compilerOptions": {
        "types": ["node"]
    }
}
```

### Build for all supported environments

For Deno, no build is needed. For all other environments run:

`bun run build`

### Code quality

`bun run qa` - apply formatting and safe fixes

`bun run qau` - apply formatting and unsafe fixes

`bun run qc` - check code quality

`bun run qts` - TypeScript type check

### Run tests

`bun run test` - WebSocket protocol

`SURREAL_DEFAULT_PROTOCOL=http bun test` - HTTP protocol

### PRs

Before you commit, please format and lint your code accordingly to check for errors, and ensure all tests still pass.

### Editor extensions

For local development the [Bun extension](https://marketplace.visualstudio.com/items?itemName=oven.bun-vscode) and [Biome extension](https://marketplace.visualstudio.com/items?itemName=biomejs.biome) for VSCode are helpful.

### Directory structure

- `./biome.json` - code quality settings
- `./scripts` - build and publish scripts
- `./packages/sdk` - JavaScript SDK (`surrealdb` on npm)
- `./packages/sqon` - SQON value types and codecs
- `./packages/node` - embedded Node.js engine
- `./packages/wasm` - embedded WebAssembly engine
- `./packages/spectron` - Spectron HTTP client
- `./packages/tests` - test suite (`surrealdb/` for the SDK, `spectron/` for Spectron)
- `./demo/wasm` - WebAssembly demo
- `./demo/node` - Node.js demo
