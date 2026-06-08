const proc = Bun.spawnSync(
    ["bunx", "openapi-typescript", "./spec/openapi.json", "-o", "./src/types/generated.ts"],
    {
        cwd: import.meta.dir,
        stdout: "inherit",
        stderr: "inherit",
    },
);
if (proc.exitCode !== 0) process.exit(proc.exitCode ?? 1);
