import { rolldown } from "rolldown";

// Primary
const bundle = await rolldown({
    input: "./src/index.ts",
});
await bundle.write({ format: "esm", file: "./dist/surrealdb.mjs" });
await bundle.write({ format: "cjs", file: "./dist/surrealdb.cjs" });

// Server-side bundle (Node/Bun/Deno)
const serverBundle = await rolldown({
    input: "./src/index.server.ts",
    external: ["node:util", "surrealdb"],
});
await serverBundle.write({ format: "esm", file: "./dist/surrealdb.server.mjs" });
await serverBundle.write({ format: "cjs", file: "./dist/surrealdb.server.cjs" });

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
