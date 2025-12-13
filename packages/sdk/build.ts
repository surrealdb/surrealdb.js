import { rolldown } from "rolldown";

// Primary
const bundle = await rolldown({
    input: "./src/index.ts",
});
await bundle.write({ format: "esm", file: "./dist/surrealdb.mjs" });
await bundle.write({ format: "cjs", file: "./dist/surrealdb.cjs" });

// Server-side bundle (Node/Bun/Deno)
const nodeBundle = await rolldown({
    input: "./src/index.node.ts",
    external: ["node:util"],
});
await nodeBundle.write({ format: "esm", file: "./dist/surrealdb.node.mjs" });
await nodeBundle.write({ format: "cjs", file: "./dist/surrealdb.node.cjs" });

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
