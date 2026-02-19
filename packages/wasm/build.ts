import { rolldown } from "rolldown";

const isDebug = process.argv.includes("--debug") || !!process.env.DEBUG_WASM;
const profile = isDebug ? "release-debug" : "release";
const features = isDebug ? "kv-indxdb,kv-mem,debug" : "kv-indxdb,kv-mem";

// Build the WASM module
console.log(`🔨 Building the WASM module (profile: ${profile})`);

await Bun.spawn(["cargo", "build", `--profile`, profile, "--features", features]).exited;

// Generate the bindings
console.log("🔨 Generating the bindings");

await Bun.spawn([
    "wasm-bindgen",
    "--target",
    "web",
    `target/wasm32-unknown-unknown/${profile}/surrealdb.wasm`,
    "--out-dir",
    "wasm",
]).exited;

// Optimize the WASM module (skipped in debug mode to preserve function names)
if (!isDebug) {
    console.log("🔨 Optimizing the WASM module");
    await Bun.spawn([
        "wasm-opt",
        "-Oz",
        "--enable-bulk-memory",
        "--enable-nontrapping-float-to-int",
        "wasm/surrealdb_bg.wasm",
        "-o",
        "wasm/surrealdb_bg.wasm",
    ]).exited;
} else {
    console.log("🔨 Skipping WASM optimization (debug mode)");
}

// Bundle the engine implementation
console.log("🔨 Generating the package bundle");

const bundle = await rolldown({
    input: "./src-ts/index.ts",
    external: ["surrealdb"],
});

// ESModule only (we require top level await)
await bundle.write({
    format: "esm",
    file: "./dist/surrealdb-wasm.mjs",
});

// Generate the worker script
const worker = await rolldown({
    input: "./src-ts/worker/worker-agent.ts",
    external: ["surrealdb"],
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
