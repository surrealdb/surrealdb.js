import { major, minor, patch, SemVer } from "semver";

// Update the SurrealDB dependency in the Cargo.toml file
console.log("✨ Updating SurrealDB dependency");

await Bun.spawn(["cargo", "update", "-p", "surrealdb", "-q"]).exited;

// Extract the version from the Cargo.toml file
console.log("🌐 Synchronizing SurrealDB version");

const pkgidTask = Bun.spawn(["cargo", "pkgid", "-p", "surrealdb"]);
const pkgid = await Bun.readableStreamToText(pkgidTask.stdout);
const crateVersion = pkgid.split("@")[1]?.trim() ?? "";

// Check the package version
console.log("🔍 Checking package version");

const packageJson = await Bun.file("package.json").json();

const majorMatch = major(crateVersion) === major(packageJson.version);
const minorMatch = minor(crateVersion) === minor(packageJson.version);
const currentPatch = patch(packageJson.version);

const newVersion = new SemVer(crateVersion);

console.log(majorMatch, minorMatch, currentPatch);

if (majorMatch === minorMatch) {
    newVersion.patch = currentPatch;
} else {
    newVersion.patch = 0;
}

packageJson.version = newVersion.format();

await Bun.write("package.json", JSON.stringify(packageJson, null, 2));
await Bun.spawn(["bunx", "biome", "format", "--write", "package.json"]).exited;

console.log(
    `👉 SurrealDB version updated to ${major(crateVersion)}.${minor(crateVersion)} rev ${newVersion.patch}`,
);
