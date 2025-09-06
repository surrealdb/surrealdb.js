
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
const [packageVersion, surrealVersion] = packageJson.version.split("+");

if (surrealVersion !== crateVersion) {
    packageJson.version = `${packageVersion}+${crateVersion}`;
	
	await Bun.write("package.json", JSON.stringify(packageJson, null, 2));
	await Bun.spawn(["bunx", "biome", "format", "--write", "package.json"]).exited;
	
	console.log(`👉 SurrealDB version updated to ${crateVersion}`);
} else {
	console.log(`👉 SurrealDB version is up to date (${crateVersion})`);
}