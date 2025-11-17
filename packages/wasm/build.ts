import { rolldown } from "rolldown";

// Build the WASM module
console.log("🔨 Building the WASM module");

await Bun.spawn(["cargo", "build", "--release", "--features", "kv-indxdb,kv-mem"]).exited;

// Generate the bindings
console.log("🔨 Generating the bindings");

await Bun.spawn([
    "wasm-bindgen",
    "--target",
    "web",
    "../../target/wasm32-unknown-unknown/release/surrealdb.wasm",
    "--out-dir",
    "wasm",
]).exited;

// Optimize the WASM module
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
