import { rolldown } from "rolldown";
import { name, version } from "./package.json";

const bundle = await rolldown({
    input: "./src/index.ts",
});

// ESModule
await bundle.write({
    format: "esm",
    file: "./dist/surrealdb-cbor.mjs",
});

// CommonJS
await bundle.write({
    format: "cjs",
    file: "./dist/surrealdb-cbor.cjs",
});

// JSR Config
await Bun.write(
    "jsr.json",
    JSON.stringify(
        {
            version,
            name,
            exports: "./src/index.ts",
            publish: {
                include: ["src/**/*.ts"],
            },
        },
        null,
        2,
    ),
);

// TS Declarations
const task = Bun.spawn(
    [
        "bunx",
        "dts-bundle-generator",
        "-o",
        "./dist/surrealdb-cbor.d.ts",
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
