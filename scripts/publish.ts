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
let channel = "latest";

if (version.includes("-alpha")) {
    channel = "alpha";
}

if (version.includes("-beta")) {
    channel = "beta";
}

if (values.channel) {
    channel = values.channel;
}

// Copy root files into the package directory before packing
const rootFiles = ["README.md", "LICENCE", "SECURITY.md"];

console.log("📄 Copying root files...");

for (const file of rootFiles) {
    const src = Bun.file(`../../${file}`);
    if (await src.exists()) {
        await Bun.write(file, src);
    } else {
        console.warn(`⚠️ Root file not found, skipping: ${file}`);
    }
}

// Packing
const safeName = name.replaceAll("@", "-");
const packCmd = ["bun", "pm", "pack"];

console.log(`📦 Packing ${name}@${version}...`);

const packCode = await Bun.spawn(packCmd, {
    stdout: "inherit",
    stderr: "inherit",
}).exited;

if (values.continue && packCode !== 0) {
    console.log("❌ Pack failed, but continuing...");
    process.exit(0);
}

// Publishing to NPM
const publishCmd = [
    "npm",
    "publish",
    `${safeName}-${version}.tgz`,
    "--provenance",
    "--loglevel",
    "silly",
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
}).exited;

if (values.continue && publishCode !== 0) {
    console.log("❌ NPM publish failed, but continuing...");
} else if (publishCode !== 0) {
    process.exit(publishCode);
}

// Publishing to JSR (only if jsr.json exists)
const jsrFile = Bun.file("jsr.json");
const jsrExists = await jsrFile.exists();

if (jsrExists) {
    const jsrPublishCmd = ["npx", "jsr", "publish", "--allow-slow-types"];

    if (values["dry-run"]) {
        jsrPublishCmd.push("--dry-run");
    }

    console.log(`🚀 Publishing ${name}@${version} to JSR...`);

    const jsrPublishCode = await Bun.spawn(jsrPublishCmd, {
        stdout: "inherit",
        stderr: "inherit",
    }).exited;

    if (values.continue && jsrPublishCode !== 0) {
        console.log("❌ JSR publish failed, but continuing...");
        process.exit(0);
    }

    process.exit(jsrPublishCode);
} else {
    process.exit(publishCode);
}
