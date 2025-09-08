import { rolldown } from "rolldown";

const bundle = await rolldown({
    input: "./src/index.ts",
});

// ESModule
await bundle.write({
    format: "esm",
    file: "./dist/surrealdb.mjs",
});

// CommonJS
await bundle.write({
    format: "cjs",
    file: "./dist/surrealdb.cjs",
});

// TS Declarations
const task = Bun.spawn(
    [
        "bunx",
        "dts-bundle-generator",
        "-o",
        "./dist/surrealdb.d.ts",
        "./src/index.ts",
        "--no-check",
        "--export-referenced-types",
        "false",
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
