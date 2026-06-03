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

// Create a new Spectron client (pinned to one context)
const client = new Spectron({
  endpoint: process.env.SPECTRON_ENDPOINT!,
  context: "acme-prod",
  apiKey: process.env.SPECTRON_API_KEY!,
});

// Upload a document
const document = await client.documents.upload({
  file: documentFile,
  title: "Handbook",
});

// Remember a fact and recall it
await client.remember("I just got promoted to CTO", { scope: { user: "tobie" } });
const hits = await client.recall("What is Tobie's role?", { k: 10 });

// Chat (server-driven memory loop)
const { reply } = await client.chat("What do you know about me?");
```

## Memory operations

```ts
// Persist facts from free text and/or caller-supplied triples (idempotent).
await client.remember("Tobie prefers dark mode", { infer: "full" });

// Persist a batch of conversation messages.
await client.rememberMany([
  { role: "user", content: "I moved to Lisbon" },
  { role: "assistant", content: "Noted." },
]);

// Recall, context, reflection, and forgetting.
await client.recall("Where does Tobie live?", { k: 5 });
await client.context("Summarise preferences", { k: 5 });
await client.reflect("What changed this week?", { persist: true });
await client.forget("Remove old project notes", { purge: true });

// Snapshots and maintenance.
await client.state();
await client.profile();
await client.consolidate({ dryRun: true });
await client.elaborate({ entityRef: "person:tobie" });
await client.fsck();
await client.inspect("person:tobie");
await client.audit({ limit: 50 });
```

### Streaming chat

```ts
const stream = await client.chat("Tell me a story", { stream: true });
for await (const chunk of stream) {
  process.stdout.write(chunk.delta);
}
```

## Namespaces

| Namespace | Highlights |
| --- | --- |
| `client.documents` | `upload`, `reprocess`, `get`, `raw`, `chunks`, `list`, `delete`, `query`, `recomputeLinks`, `keywords.*` |
| `client.entities` | `list`, `get`, `history`, `delete` |
| `client.sessions` | `create` → `Session` (`turns`, `context`, `close`) |
| `client.lifecycle` | `expire`, `decay` |
| `client.traces` | `list`, `get`, `stats` |
| `client.principals` | `list`, `get`, `effective`, `grant`, `revoke` |
| `client.scopes` | `list`, `register`, `delete`, `forget` |

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

Catch subclasses of `SpectronError`, or use `errorFromResponse` directly.

## Retries & idempotency

Idempotent `GET` requests retry on `5xx` and connection failures with backoff `250ms`, `500ms`, `1000ms` (up to `maxRetries`, default `3`). The `remember` and `rememberMany` writes carry an `Idempotency-Key` derived from the request and a 30-second window, so they are retried safely too; other mutating methods are not retried automatically.

## Scope

Write and session calls accept `scope?: Scope`, where `Scope` is a single `key=value/` path string, an array of such strings, a `Record<string, string>`, or an array of `[key, value]` tuples. All forms normalise to the wire `ScopeSet` (a string array) via `normaliseScope`.

## Regenerating API types

After updating `spec/openapi.json`, run `bun run generate` in this package, then `bun run build`.
