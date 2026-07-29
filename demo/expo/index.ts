// biome-ignore assist/source/organizeImports: the polyfill import must stay first
import { installPolyfills } from "./polyfills";
import { registerRootComponent } from "expo";
import { App } from "./App";

/**
 * Install the Hermes shims before anything uses them.
 *
 * A bare `import "./polyfills"` would be the obvious approach, and it is not good enough
 * here:
 *
 * - Under Metro/Babel, ESM is lowered to CommonJS by
 *   `@babel/plugin-transform-modules-commonjs`, which hoists the `require()` calls in
 *   source order - so the *transform* preserves ordering.
 * - But this repo enables Biome's `organizeImports` assist repo-wide, and `"./App"` sorts
 *   before `"./polyfills"`. One `bun run qa` would silently move the polyfill import after
 *   the import that pulls in the `surrealdb` module graph, with no error anywhere.
 *
 * So the install is an explicit *statement* instead. Statements cannot be hoisted above
 * imports, which makes this a real guarantee rather than a convention: by the time
 * `installPolyfills()` returns, every shim is in place, whatever order the module graph
 * above was evaluated in. The suppression comment keeps the source order tidy too, but
 * nothing depends on it.
 *
 * That is sufficient because nothing in the `surrealdb` bundle *reads* a missing global at
 * module-evaluation time. The gaps are all reached at call time (`new Uuid(...)`, CBOR
 * encode/decode, JWT parsing, socket error handling), and `App` creates its `Surreal`
 * instance on first render - which happens after `registerRootComponent` hands the
 * component to `AppRegistry`, long after this line.
 */
installPolyfills();

registerRootComponent(App);
