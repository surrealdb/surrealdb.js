<br>

<p align="center">
    <img width=120 src="https://raw.githubusercontent.com/surrealdb/icons/main/surreal.svg" />
</p>

<h1 align="center">@surrealdb/sqon</h1><br/>
<p align="center">SurrealQL value types, codecs, and utilities</p>

<br>

<p align="center">
    <a href="https://github.com/surrealdb/surrealdb.js"><img src="https://img.shields.io/badge/status-stable-ff00bb.svg?style=flat-square"></a>
    &nbsp;
    <a href="https://surrealdb.com/docs/sdk/javascript"><img src="https://img.shields.io/badge/docs-view-44cc11.svg?style=flat-square"></a>
    &nbsp;
    <a href="https://www.npmjs.com/package/@surrealdb/sqon"><img src="https://img.shields.io/npm/v/@surrealdb/sqon?style=flat-square"></a>
</p>

<p align="center">
    <a href="https://surrealdb.com/discord"><img src="https://img.shields.io/discord/902568124350599239?label=discord&style=flat-square&color=5a66f6"></a>
    &nbsp;
    <a href="https://twitter.com/surrealdb"><img src="https://img.shields.io/badge/twitter-follow_us-1d9bf0.svg?style=flat-square"></a>
    &nbsp;
    <a href="https://www.linkedin.com/company/surrealdb/"><img src="https://img.shields.io/badge/linkedin-connect_with_us-0a66c2.svg?style=flat-square"></a>
</p>

## Documentation

View the JavaScript SDK documentation [here](https://surrealdb.com/docs/sdk/javascript), including the [value types](https://surrealdb.com/docs/languages/javascript/concepts/value-types), [utilities](https://surrealdb.com/docs/languages/javascript/concepts/utilities), and [codecs](https://surrealdb.com/docs/languages/javascript/concepts/codecs) concept pages.

## What is SQON?

**SQON** (SurrealQL Object Notation) is the family of data representation formats used by SurrealDB to encode its rich value system. This package provides:

- **Value classes** - `RecordId`, `Table`, `DateTime`, `Decimal`, and other SurrealQL types that have no direct JavaScript equivalent
- **Codecs** - `CborCodec` and `JsonCodec` for serialising and deserialising values without losing type information
- **Utilities** - helpers such as `equals`, `jsonify`, `escapeIdent`, and `toSurqlString`

The full [`surrealdb`](https://www.npmjs.com/package/surrealdb) SDK re-exports everything from `@surrealdb/sqon` for convenience. Install this package directly when you only need value types and codecs - for example when building a custom client, middleware, or data pipeline - without pulling in the database driver.

## How to install

Run the following command to add SQON to your project:

```sh
# using npm
npm i @surrealdb/sqon

# or using pnpm
pnpm i @surrealdb/sqon

# or using yarn
yarn add @surrealdb/sqon

# or using bun
bun add @surrealdb/sqon
```

You can now import value types and utilities with:

```ts
import { RecordId, Table, DateTime, Decimal, equals, jsonify } from "@surrealdb/sqon";
```

Or import everything from the SDK instead:

```ts
import { RecordId, Table, Surreal } from "surrealdb";
```

## Getting started

### Value types

Use value classes to construct and validate SurrealQL values in application code.

```ts
import { RecordId, Table, DateTime, Duration, Decimal, Uuid } from "@surrealdb/sqon";

const userId = new RecordId("users", "john");
const users = new Table("users");

const now = DateTime.now();
const duration = Duration.parse("1h30m");
const price = new Decimal("19.99");
const id = Uuid.v7();

const parsed = RecordId.parse("users:john");
```

Most value classes support parsing from SurrealQL string syntax and expose instance methods such as `.equals()` and `.toString()`.

### Codecs

Codecs convert between JavaScript value instances and wire formats. Two codecs are available today:

| Codec | Wire format | Typical use |
| --- | --- | --- |
| `CborCodec` | `Uint8Array` (CBOR) | WebSocket and HTTP RPC transport to SurrealDB |
| `JsonCodec` | Plain object tree (SQON JSON) | JSON-safe interchange, logging, and HTTP APIs, LLM communication |

```ts
import {
    CborCodec,
    JsonCodec,
    RecordId,
    Decimal,
} from "@surrealdb/sqon";

const cbor = CborCodec.DEFAULT;
const json = JsonCodec.DEFAULT;

const value = {
    id: new RecordId("person", "tobie"),
    balance: new Decimal("1234.5678"),
};

const wire = cbor.encode(value);
const restored = cbor.decode(wire);

const sqonJson = json.encode(value);
// { id: { $recordId: { tb: "person", id: "tobie" } }, balance: { $decimal: "1234.5678" } }
const fromJson = json.decode(sqonJson);
```

Configure codecs with `CodecOptions` - for example, decode datetimes as native `Date` objects instead of `DateTime`:

```ts
const codec = new CborCodec({ useNativeDates: true });
```

The CBOR tag specification is documented in the [CBOR protocol reference](https://surrealdb.com/docs/reference/rest-api/cbor-protocol).

### Utilities

SQON provides utilities for comparing, converting, and escaping values:

```ts
import {
    equals,
    jsonify,
    escapeIdent,
    escapeValue,
    toSurqlString,
    RecordId,
} from "@surrealdb/sqon";

const a = new RecordId("users", "john");
const b = new RecordId("users", "john");

equals(a, b); // true

jsonify({ id: a }); // { id: "users:john" }

escapeIdent("user-table"); // `user-table`
toSurqlString(a); // r"users:john"
```

Query-building utilities such as `surql`, `expr`, and `BoundQuery` live in the `surrealdb` SDK, not in this package.

## Using with the SurrealDB SDK

When you create a `Surreal` client, the SDK registers default codecs and uses `CborCodec` for WebSocket and HTTP RPC communication. You can customise codec behaviour through `DriverOptions`:

```ts
import { Surreal } from "surrealdb";

const db = new Surreal({
    codecOptions: {
        useNativeDates: true,
    },
});
```

See the [codecs concept page](https://surrealdb.com/docs/languages/javascript/concepts/codecs) for details on when to use each format and how the SDK wires codecs in.

## Package contents

| Export | Description |
| --- | --- |
| Value classes | `RecordId`, `Table`, `DateTime`, `Duration`, `Decimal`, `Uuid`, `Range`, `FileRef`, `Geometry*`, and more |
| Codecs | `CborCodec`, `JsonCodec`, `CodecOptions`, `ValueCodec` |
| Utilities | `equals`, `jsonify`, `escapeIdent`, `escapeKey`, `escapeRid`, `escapeValue`, `toSurqlString` |
| Errors | `SqonError`, `InvalidDateError`, `InvalidRecordIdError`, and related validation errors |

> **Note:** `FlatBufferCodec` is exported for future API compatibility but is not implemented in this version.

## Contributing

This package is part of the [surrealdb.js](https://github.com/surrealdb/surrealdb.js) monorepo. See the [main README](https://github.com/surrealdb/surrealdb.js/blob/main/README.md) for local setup, build commands, and contribution guidelines.
