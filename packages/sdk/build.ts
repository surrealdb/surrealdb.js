import { rolldown } from "rolldown";
import { name, version } from "./package.json";

const mainBundle = await rolldown({
    input: "./src/index.ts",
});

const exprBundle = await rolldown({
    input: "./src/expressions.ts",
});

// ESModule
await mainBundle.write({
    format: "esm",
    file: "./dist/surrealdb.mjs",
});

await exprBundle.write({
    format: "esm",
    file: "./dist/surrealdb-expr.mjs",
});

// CommonJS
await mainBundle.write({
    format: "cjs",
    file: "./dist/surrealdb.cjs",
});

await exprBundle.write({
    format: "cjs",
    file: "./dist/surrealdb-expr.cjs",
});

// JSR Config
await Bun.write(
    "jsr.json",
    JSON.stringify(
        {
            version,
            name: `@surrealdb/${name}`,
            exports: {
                "./": "./src/index.ts",
                "./expr": "./src/expressions.ts",
            },
            publish: {
                include: ["src/**/*.ts"],
            },
        },
        null,
        2,
    ),
);

// TS Declarations
await Bun.spawn(
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
).exited;

await Bun.spawn(
    [
        "bunx",
        "dts-bundle-generator",
        "-o",
        "./dist/surrealdb-expr.d.ts",
        "./src/expressions.ts",
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
).exited;
