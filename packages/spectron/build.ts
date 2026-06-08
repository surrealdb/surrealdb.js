import { rolldown } from "rolldown";
import { version } from "./package.json";

const bundle = await rolldown({
    input: "./src/index.ts",
    define: {
        "import.meta.env.VERSION": JSON.stringify(version),
    },
});

await bundle.write({ format: "esm", file: "./dist/spectron.mjs" });
await bundle.write({ format: "cjs", file: "./dist/spectron.cjs" });

const task = Bun.spawn(
    [
        "bunx",
        "dts-bundle-generator",
        "-o",
        "./dist/spectron.d.ts",
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
