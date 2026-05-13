# @surrealdb/spectron

Typed REST client for the [Spectron](https://surrealdb.com/platform/spectron) API. It uses your platform `fetch`, ships no runtime dependencies, and does not depend on the `surrealdb` package.

## Install

```sh
bun add @surrealdb/spectron
# or npm / pnpm / yarn
```

## Quick start

```ts
import { Spectron } from "@surrealdb/spectron";

const client = new Spectron({
  context: "acme-prod",
  baseUrl: "https://api.spectron.dev",
  apiKey: process.env.SPECTRON_API_KEY!,
});

await client.health();

const session = await client.sessions.create({ scope: { user: "tobie" } });
await session.turn({ role: "user", content: "I just got promoted to CTO" });
await session.chat({ message: "What do you know about me?" });
await session.close();

await client.knowledge.upload({
  file: documentFile,
  title: "Handbook",
});
```

## Knowledge file inputs

`knowledge.upload` and `knowledge.replace` accept `File`, `Blob`, `Uint8Array` (and other `ArrayBufferView` / `ArrayBuffer`), and `ReadableStream<Uint8Array>`. Streams are buffered in full before multipart upload so behaviour is consistent across runtimes; very large files may warrant a future streaming-oriented API.

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

## Publishing (maintainers)

Releases are **not** tied to GitHub Releases. Merge the intended `version` in `package.json`, then run the **Publish Spectron** workflow from the Actions tab (`workflow_dispatch`). Use `dry run` first if you want an npm `--dry-run`.

## Regenerating API types

After updating `spec/openapi.json`, run `bun run generate` in this package, then `bun run build`.
