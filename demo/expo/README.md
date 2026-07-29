# SurrealDB Expo demo

A minimal Expo app that connects to a remote SurrealDB instance over WebSocket, upserts
records, and streams live query notifications — running on Hermes.

- Connection status driven by the SDK's own `connecting` / `connected` / `reconnecting` /
  `disconnected` / `error` events
- A button that upserts a record
- A scrolling log of live query notifications, newest first
- A runtime capability panel, because some of the gaps this app papers over fail silently
  rather than loudly

## Remote only, on purpose

This demo talks to a **remote** SurrealDB over `ws://` using `createRemoteEngines()`. The
embedded engines cannot work here: `@surrealdb/wasm` needs a WebAssembly runtime and
`@surrealdb/node` is a native N-API addon. Neither exists on Hermes.

There is also no web target, no Expo Router and no API routes. That is deliberate: any of
them can make Metro resolve packages under the `node` export condition, which would select
the SDK's `dist/surrealdb.server.mjs` entry and drag `node:util` into the bundle.

## Prerequisites

- [Bun](https://bun.sh) — this repo's package manager
- A SurrealDB binary, `>= 2.1.0` and `< 4.0.0` (the SDK's supported range)
- Xcode (iOS simulator) and/or Android Studio (Android emulator), or the Expo Go app on a
  physical device

## 1. Build the SDK

This demo depends on `surrealdb: "workspace:*"`, and that package's entry point resolves to
`dist/`, which is **not** checked in. Build it first:

```sh
bun install
bun run build:sdk
```

Re-run `bun run build:sdk` after any change under `packages/sdk/src` or `packages/sqon/src`
— Metro consumes the built bundle, not the source.

## 2. Start SurrealDB

```sh
surreal start --user root --pass root --bind 0.0.0.0:8000 memory
```

`--bind 0.0.0.0:8000` matters. The default binds loopback only, which the Android emulator
can still reach through its `10.0.2.2` alias, but a **physical device cannot**. Note that
`0.0.0.0` exposes a root user to everything on your network — use it on a network you trust,
and stop the server when you are done.

The demo writes to namespace `demo`, database `demo`, table `demo_items`, and defines all
three itself on connect with `DEFINE ... IF NOT EXISTS`. SurrealDB 3.x does not create them
on demand, and `LIVE SELECT` against a table that does not exist fails outright — so a plain
`memory` server needs no manual setup, but it does need that bootstrap. It runs as root; a
real app would ship it as a migration instead.

## 3. Point the app at your machine

`ws://localhost:8000` is only correct in the **iOS simulator**, which shares your host's
loopback interface. [`config.ts`](./config.ts) defaults to `10.0.2.2` on Android, which is
the emulator's alias for the host loopback. Neither works on a physical device, where
`localhost` is the phone itself.

For a physical device, find your host's LAN address (`ipconfig getifaddr en0` on macOS) and
set:

```sh
EXPO_PUBLIC_SURREAL_URL=ws://192.168.1.20:8000 bun run demo:expo -- --clear
```

`EXPO_PUBLIC_*` variables are **inlined into the bundle at build time**; they are not read
at runtime. Changing one requires restarting Metro with a cleared cache. The other overrides
are `EXPO_PUBLIC_SURREAL_NAMESPACE`, `EXPO_PUBLIC_SURREAL_DATABASE`,
`EXPO_PUBLIC_SURREAL_USERNAME` and `EXPO_PUBLIC_SURREAL_PASSWORD`.

Credentials configured this way end up in the shipped bundle. That is fine for a local demo
and wrong for a real app, which should authenticate with a record access method or a token
minted by your own backend.

## 4. Run

```sh
bun run demo:expo
```

Then press `i` for the iOS simulator or `a` for the Android emulator, or scan the QR code
with Expo Go.

## What to expect

1. The status dot goes amber (`connecting`) then green (`connected`), and the log records
   the server version. Namespace, database and sign-in all complete *before* `connected` is
   published, so a green dot means the session is ready.
2. The log records the registered live query id.
3. Tapping **Upsert a record** writes `demo_items:1`, `demo_items:2`, … Each write produces
   a `CREATE` notification in the log within a few milliseconds. Tapping again after a
   reload produces `UPDATE` for ids that already exist.
4. Stop the server and the status goes amber (`reconnecting`); restart it and the SDK
   reconnects, re-applies namespace/database/credentials and re-registers the live query on
   its own.
5. If the capability panel appears at the top, read the matching troubleshooting entry below
   before trying anything else.

## Troubleshooting

**Status stays `connecting`, or an `UnexpectedConnectionError` appears.** Almost always the
endpoint. Check, in order: is the server bound to `0.0.0.0`; are the device and host on the
same network; does the platform default apply to you (see step 3). Verify the endpoint from
your host first with `curl -v http://localhost:8000/health`.

**Anything CBOR-shaped: garbled results, a SQON error, or a `TypeError` mentioning
`getBigUint64` / `setBigUint64`.** The bundled `@surrealdb/cbor` reads and writes 64-bit
integers through `DataView.prototype.getBigUint64` / `setBigUint64`. These were verified
working on iOS with Expo SDK 57 / Hermes, but they are the least portable thing the SDK
depends on, so check them first if CBOR misbehaves on another platform or SDK version.
[`polyfills.ts`](./polyfills.ts) installs a guarded shim built on `getUint32`/`setUint32`,
and the capability panel round-trips the maximum unsigned 64-bit value to prove which
implementation is in use. Only integers of `2 ** 32` or more take that path — `Date.now()`
(~1.7e12) is enough, which is why the demo's payload uses small values. If you add a large
integer field and things break, this is why.

**`crypto.getRandomValues` listed as missing.** `expo-crypto` failed to load. `Uuid.v4()` /
`Uuid.v7()` still work but fall back to `Math.random()`, silently. Run
`bunx expo install expo-crypto` and reload; if you are on a custom dev client rather than
Expo Go, rebuild it.

**`atob` listed as missing.** Nothing crashes: the SDK's JWT parsing catches the failure and
returns `null`, so access token expiry is never read and renewal is never scheduled. The
session works and then quietly dies when the token expires. `polyfills.ts` shims it; if the
panel still reports it missing, `installPolyfills()` is not running before first render.

**An unsupported-version error for a version that looks fine.** The SDK's version check uses
`localeCompare(..., { numeric: true })`, and Hermes' Intl support is not a browser's. Confirm
your server version is `>= 2.1.0` and `< 4.0.0`, then pass `versionCheck: false` in the
`connect()` options in `App.tsx` to rule the check out.

**Two connections, or duplicate notifications, after editing `App.tsx`.** Fast Refresh can
leave the previous client connected. Press `r` in the Metro terminal to reload fully. React
StrictMode's double effect invocation is *not* the cause — that case is handled.

**A stale endpoint after changing an env var.** `EXPO_PUBLIC_*` values are baked in at build
time. Restart with `--clear`.

**Module resolution errors mentioning `node:util`.** Something made Metro resolve `surrealdb`
under the `node` export condition, which selects the SDK's server bundle. Do not add a web
target or Expo Router to this demo.

## Files

| File | Purpose |
| --- | --- |
| [`index.ts`](./index.ts) | Entry point. Installs polyfills, then registers the root component |
| [`polyfills.ts`](./polyfills.ts) | Guarded Hermes shims, plus the runtime capability probe |
| [`config.ts`](./config.ts) | Endpoint, namespace, database and credentials |
| [`App.tsx`](./App.tsx) | The screen: status, upsert button, notification log, error surface |
