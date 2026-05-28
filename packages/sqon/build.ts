import { rolldown } from "rolldown";

const bundle = await rolldown({
    input: "./src/index.ts",
});
await bundle.write({ format: "esm", file: "./dist/sqon.mjs" });
await bundle.write({ format: "cjs", file: "./dist/sqon.cjs" });

const task = Bun.spawn(
    [
        "bunx",
        "dts-bundle-generator",
        "-o",
        "./dist/sqon.d.ts",
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
