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
const packageExists = await Bun.file("package.json").exists();

if (!packageExists) {
    console.error("❌ Required package.json not found");
    process.exit(1);
}

// Prepare command
const npmCmd = ["bun", "publish", "--access", "public", "--tag", "latest"];

if (dryrun) {
    npmCmd.push("--dry-run");
}

// NPM
console.log("📦 Publishing to NPM...");

const code = await Bun.spawn(npmCmd, {
    stdout: "inherit",
    stderr: "inherit",
    env: import.meta.env,
}).exited;

process.exit(code);
