import { parseArgs } from "node:util";

const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
        "dry-run": {
            type: "boolean",
        },
    },
});

const dryrun = values["dry-run"] ?? false;

// Check required files
const jsrExists = await Bun.file("jsr.json").exists();
const packageExists = await Bun.file("package.json").exists();

if (!jsrExists || !packageExists) {
    console.error("❌ Required files not found");
    process.exit(1);
}

// Prepare commands
const jsrCmd = ["bunx", "jsr", "publish", "--allow-dirty"];
const npmCmd = ["bun", "publish", "--access", "public", "--tag", "latest"];

if (dryrun) {
    jsrCmd.push("--dry-run");
    npmCmd.push("--dry-run");
} else {
    console.log("NAH");
    process.exit(1);
}

// JSR
console.log("📦 Publishing JSR...");

await Bun.spawn(jsrCmd, {
    stdout: "inherit",
    stderr: "inherit",
    env: import.meta.env,
    async onExit(_, exitCode) {
        if (exitCode !== 0) process.exit(exitCode);
    },
}).exited;

// NPM
console.log("📦 Publishing NPM...");

await Bun.spawn(npmCmd, {
    stdout: "inherit",
    stderr: "inherit",
    env: import.meta.env,
    async onExit(_, exitCode) {
        if (exitCode !== 0) process.exit(exitCode);
    },
}).exited;
