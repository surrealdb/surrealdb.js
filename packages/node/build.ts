/**
 * Bundle the Node engine.
 *
 * There is nothing to compile here: the native addon is published separately as
 * `@surrealdb/node-native`, built from the engine it embeds in the SurrealDB
 * repository. This package is the `SurrealEngine` implementation that wraps it,
 * so the build is a bundle and a declaration file.
 */

import { rolldown } from "rolldown";

console.log("🔨 Generating the package bundle");

const bundle = await rolldown({
    input: "./src-ts/index.ts",
    // Both stay external: `surrealdb` is a peer dependency, and the addon
    // resolves its own platform binary at runtime.
    external: ["surrealdb", "@surrealdb/node-native"],
});

// ESModule only (we require top level await)
await bundle.write({
    format: "esm",
    file: "./dist/surrealdb-node.mjs",
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
        "./dist/surrealdb-node.d.ts",
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
