/**
 * Bundle the WebAssembly engine.
 *
 * There is nothing to compile here: the module is published separately as
 * `@surrealdb/wasm-native`, built from the engine it embeds in the SurrealDB
 * repository. This package is the `SurrealEngine` implementation that wraps it,
 * so the build is two bundles — the engine and the Web Worker agent — and a
 * declaration file.
 */

import { rolldown } from "rolldown";

console.log("🔨 Generating the package bundle");

// Both stay external: `surrealdb` is a peer dependency, and the module resolves
// its own WebAssembly beside its loader.
const external = ["surrealdb", "@surrealdb/wasm-native"];

const bundle = await rolldown({
    input: "./src-ts/index.ts",
    external,
});

// ESModule only (we require top level await)
await bundle.write({
    format: "esm",
    file: "./dist/surrealdb-wasm.mjs",
});

// Generate the worker script
const worker = await rolldown({
    input: "./src-ts/worker/worker-agent.ts",
    external,
});

// ESModule only (we require top level await)
await worker.write({
    format: "esm",
    file: "./dist/worker-agent.mjs",
});

// TS Declaration
const task = Bun.spawn(
    [
        "bunx",
        "dts-bundle-generator",
        "--project",
        "tsconfig.types.json",
        "--no-check",
        "--disable-symlinks-following",
        "--export-referenced-types",
        "false",
        "-o",
        "./dist/surrealdb-wasm.d.ts",
        "./src-ts/index.ts",
    ],
    {
        stdout: "inherit",
        stderr: "inherit",
        async onExit(_, exitCode) {
            if (exitCode !== 0) process.exit(exitCode);
        },
    },
);

await task.exited;
