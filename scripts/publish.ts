import { parseArgs } from "node:util";

const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
        "dry-run": {
            type: "boolean",
            default: false,
        },
        continue: {
            type: "boolean",
            default: false,
        },
        channel: {
            type: "string",
        },
    },
});

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

if (values.channel) {
    channel = values.channel;
}

// Packing
const packCmd = ["bun", "pm", "pack", "--filename", "publish.tgz"];

console.log(`📦 Packing ${name}@${version}...`);

const packCode = await Bun.spawn(packCmd, {
    stdout: "inherit",
    stderr: "inherit",
    env: import.meta.env,
}).exited;

if (values.continue && packCode !== 0) {
    console.log("❌ Pack failed, but continuing...");
    process.exit(0);
}

// Publishing
const publishCmd = [
    "npm",
    "publish",
    "./publish.tgz",
    "--provenance",
    "--access",
    "public",
    "--tag",
    channel,
];

if (values["dry-run"]) {
    console.log("🔍 Preparing dry run release...");
    publishCmd.push("--dry-run");
}

console.log(`🚀 Publishing ${name}@${version} to ${channel} in NPM...`);

const publishCode = await Bun.spawn(publishCmd, {
    stdout: "inherit",
    stderr: "inherit",
    env: import.meta.env,
}).exited;

if (values.continue && publishCode !== 0) {
    console.log("❌ Publish failed, but continuing...");
    process.exit(0);
}

process.exit(publishCode);
