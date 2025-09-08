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
const packageFile = Bun.file("package.json");
const packageExists = await packageFile.exists();

if (!packageExists) {
    console.error("❌ Required package.json not found");
    process.exit(1);
}

const { name, version } = await packageFile.json();

// Compute channel
let channel = "stable";

if (version.includes("-alpha")) {
    channel = "alpha";
}

if (version.includes("-beta")) {
    channel = "beta";
}

// Prepare command
const npmCmd = ["bun", "publish", "--access", "public", "--tag", channel];

if (dryrun) {
    npmCmd.push("--dry-run");
}

// NPM
console.log(`📦 Publishing ${name}@${version} to ${channel} in NPM...`);

const code = await Bun.spawn(npmCmd, {
    stdout: "inherit",
    stderr: "inherit",
    env: import.meta.env,
}).exited;

process.exit(code);
