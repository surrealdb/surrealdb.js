import { rolldown } from "rolldown";

// Primary
const bundle = await rolldown({
    input: "./src/index.ts",
    external: [/^@opentelemetry\//],
});
await bundle.write({
    format: "esm",
    file: "./dist/surrealdb-telemetry.mjs",
});

// TS Declarations
const task = Bun.spawn(
    [
        "bunx",
        "dts-bundle-generator",
        "-o",
        "./dist/surrealdb-telemetry.d.ts",
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
