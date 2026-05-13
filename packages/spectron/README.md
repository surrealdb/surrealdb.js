# @surrealdb/spectron

Typed REST client for the [Spectron](https://surrealdb.com/platform/spectron) API. It is lightweight, uses your platform `fetch`, and ships no runtime dependencies.

## Install

Run the following command to add the SDK to your project:

```sh
# using npm
npm i @surrealdb/spectron

# or using pnpm
pnpm i @surrealdb/spectron

# or using yarn
yarn add @surrealdb/spectron

# or using bun
bun add @surrealdb/spectron
```

## Quick start

```ts
import { Spectron } from "@surrealdb/spectron";

// Create a new Spectron client
const client = new Spectron({
  context: "acme-prod",
  apiKey: process.env.SPECTRON_API_KEY!,
});

// Upload a new document
const document = await client.knowledge.upload({
  file: documentFile,
  title: "Handbook",
});

// Create a new session
const session = await client.sessions.create({ scope: { user: "tobie" } });

await session.turn({ role: "user", content: "I just got promoted to CTO" });
await session.chat({ message: "What do you know about me?" });
await session.close();

await client.knowledge.upload({
  file: documentFile,
  title: "Handbook",
});
```

## One-shot memory

```ts
await client.query({ query: "What is Tobie's role?", k: 10 });
await client.context({ query: "Summarise preferences", k: 5 });
await client.state();
await client.profile();
await client.reflect({ query: "What changed this week?", persist: true });
await client.forget({ query: "Remove old project notes" });
```

## Errors

| Class | Typical cause |
| --- | --- |
| `AuthError` | 401 |
| `ScopeError` | 403 |
| `NotFoundError` | 404 |
| `ValidationError` | 400 / 422 |
| `RateLimitError` | 429 (`retryAfter` when provided) |
| `ServerError` | 5xx |
| `ConnectionError` | Network / timeout |

Use `errorFromResponse` via the internal transport, or catch subclasses of `SpectronError`.

## Retries

Idempotent `GET` requests retry on `5xx` and connection failures with backoff `250ms`, `500ms`, `1000ms` (up to `maxRetries`, default `3`). Mutating methods are not retried automatically.

## Scope

Session and upload calls accept `scope?: Record<string, string>`, serialised wire-side as `{ key, value }[]` via `serialiseScope` / `deserialiseScope`.

## Regenerating API types

After updating `spec/openapi.json`, run `bun run generate` in this package, then `bun run build`.
