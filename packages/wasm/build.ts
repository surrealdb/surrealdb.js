// Build the WASM module
await Bun.spawn(["cargo", "build", "--release"]).exited;

// Generate the bindings
await Bun.spawn([
    "wasm-bindgen",
    "target/wasm32-unknown-unknown/release/surrealdb.wasm",
    "--out-dir",
    "build",
]).exited;

// Optimize the WASM module
await Bun.spawn(["wasm-opt", "-O", "build/surrealdb_bg.wasm", "-o", "build/surrealdb_bg.wasm"])
    .exited;
