# @surrealdb/memory

Typed REST client for the [Agent Memory](https://surrealdb.com/platform/memory) API. It is lightweight, uses your platform `fetch`, and ships no runtime dependencies.

## Install

Run the following command to add the SDK to your project:

```sh
# using npm
npm i @surrealdb/memory

# or using pnpm
pnpm i @surrealdb/memory

# or using yarn
yarn add @surrealdb/memory

# or using bun
bun add @surrealdb/memory
```

## Quick start

```ts
import { AgentMemory } from "@surrealdb/memory";

// Create a new AgentMemory client (pinned to one context)
const client = new AgentMemory({
  endpoint: process.env.AGENT_MEMORY_ENDPOINT!,
  context: "acme-prod",
  apiKey: process.env.AGENT_MEMORY_API_KEY!,
});

// Upload a document
const document = await client.documents.upload({
  file: documentFile,
  title: "Handbook",
});

// Remember a fact and recall it
await client.remember("I just got promoted to CTO", { scopes: "user/tobie" });
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
await client.state({ limit: 500 }); // bounded per table; check `truncated`
await client.profile();
await client.whoami();
await client.consolidate({ dryRun: true });
await client.elaborate({ entityRef: "person:tobie" });
await client.fsck();
await client.inspect("person:tobie");
await client.audit({ limit: 50 });

// Self-service API keys.
const minted = await client.keys.create({ name: "ci", ttlSeconds: 3600 });
await client.keys.list(); // one page; `keys.listAll()` walks them all
await client.keys.rotate("ci");
await client.keys.delete("ci");
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
| `client.documents` | `upload`, `reprocess`, `get`, `raw`, `chunks`, `allChunks`, `list`, `listAll`, `count`, `delete`, `query`, `recomputeLinks`, `keywords.*` |
| `client.entities` | `list`, `listAll`, `count`, `get`, `history`, `delete` |
| `client.sessions` | `create` → `Session` (`turns`, `allTurns`, `context`, `close`) |
| `client.lifecycle` | `expire`, `decay` |
| `client.traces` | `list`, `listAll`, `get`, `stats` |
| `client.principals` | `list`, `listAll`, `get`, `effective`, `grant`, `revoke` |
| `client.scopes` | `list`, `listAll`, `register`, `delete`, `forget` |
| `client.keys` | `create`, `list`, `listAll`, `delete`, `rotate` |

## Pagination

Every list surface pages the same way. `list` returns one page — the rows under
their collection key, plus a `page` block — and takes `limit` (default 100, max
500) and `cursor`, plus `count` on the endpoints that offer a total:

```ts
const first = await client.entities.list({ limit: 50 });
first.entities; // the rows
first.page; // { hasMore, nextCursor?, totalSize? }

// Walk by hand: follow `nextCursor` until it is absent.
let cursor: string | undefined;
do {
  const page = await client.entities.list({ limit: 50, cursor });
  handle(page.entities);
  cursor = page.page.nextCursor ?? undefined;
} while (cursor);
```

Terminate on the cursor, never on a short page. A page is bounded in the
database and then filtered for visibility, so `/scopes` and `/keys` can return
fewer rows than `limit` while more pages remain.

Every listing also has a `listAll` that does the walk for you, and the ones
worth counting have a `count` that reads `page.totalSize` from a single
one-row request:

```ts
await client.scopes.listAll(); // ScopeNodeJson[], cursors followed to exhaustion
await client.documents.count(); // number, without fetching the documents
```

`listAll` is an unbounded read by construction — reach for it when the
collection is a tree or a filter source, not a screenful. `documents.allChunks`
takes a `max` for the bounded case.

`totalSize` is opt-in (`count: true`) because it costs a full count of the
filtered set. Two endpoints do not offer it at all — `scopes.list` and
`client.audit` take `limit` and `cursor` only, typed as `CursorOptions`, so
asking them for a count is a type error rather than a rejected request.

`/documents`, `/documents/{id}/chunks`, and `/documents/keywords` also still
accept the pre-cursor `page`/`pageSize` parameters, for callers with numbered
page controls that need a page index and a total. The server rejects `cursor`
sent together with `page`, so those options are an exclusive union
(`CursorOrOffsetOptions`): picking both fails to compile.

Pagination helpers are exported for wrapping other paginated surfaces:
`walkPages`, `collectPages`, `addPageParams`, and the `PageMeta`, `PageOptions`
and `CursorOptions` types.

## Delegation

`client.onBehalfOf(principalId)` returns a new client whose every request carries the `X-Spectron-On-Behalf-Of` header, so calls run with that principal's authorisation. This requires the `manage` grant. The original client is left unchanged.

```ts
const asAlex = client.onBehalfOf("principal:alex");
await asAlex.remember("Reviewed the Q3 plan");
await asAlex.recall("What did Alex review?");
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

Catch subclasses of `AgentMemoryError`, or use `errorFromResponse` directly.

## Retries & idempotency

Idempotent `GET` requests retry on `5xx` and connection failures with backoff `250ms`, `500ms`, `1000ms` (up to `maxRetries`, default `3`). The `remember` and `rememberMany` writes carry an `Idempotency-Key` derived from the request and a 30-second window, so they are retried safely too; other mutating methods are not retried automatically.

## Scope

Write and session calls accept `scopes?: Scope`, and read calls accept the same shape as `lens?: Scope`. The wire format is a `ScopeSets`: a DNF (disjunctive-normal-form) selector, `string[][]`. The outer array is an OR of clauses; each inner array is an AND of `key/value` slash-paths. So `[["team/a"], ["team/b", "clearance/secret"]]` means `team/a OR (team/b AND clearance/secret)`.

For ergonomics a bare string is a single-path clause and a flat string array is an OR of single-path clauses, and the two mix. All forms normalise to the wire shape via `normaliseScope`. Empty paths and empty clauses are dropped; omit `scopes` entirely to use the key's default write region.

```ts
client.remember("...", { scopes: "team/eng" }); // -> [["team/eng"]]
client.remember("...", { scopes: ["team/eng", "org/acme"] }); // OR -> [["team/eng"], ["org/acme"]]
client.remember("...", { scopes: [["team/eng", "org/acme"]] }); // AND -> [["team/eng", "org/acme"]]
```
