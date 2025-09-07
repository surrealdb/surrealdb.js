#!/usr/bin/env bun

import { normalizeVersion, resolvePackages } from "./utils/package.js";

console.log("🔍 Validating package versions...");

const packages = await resolvePackages();

if (packages.length === 0) {
	console.log("❌ No packages with versions found");
	process.exit(1);
}

// Group packages by normalized version
const versionGroups = new Map<string, string[]>();

for (const pkg of packages) {
	const normalizedVersion = normalizeVersion(pkg.version);
	const currentPackages = versionGroups.get(normalizedVersion) || [];
	currentPackages.push(`${pkg.name}@${pkg.version}`);
	versionGroups.set(normalizedVersion, currentPackages);
}

// Check if all packages have the same normalized version
if (versionGroups.size !== 1) {
	console.log("❌ Package versions are inconsistent:");
	for (const [version, packageList] of versionGroups) {
		console.log(`   Version ${version}: ${packageList.join(", ")}`);
	}
	process.exit(1);
}

const [version] = versionGroups.keys();
const packageList = versionGroups.get(version)!;
const [, , match] = Bun.argv;

if (match) {
	const normalizedMatch = normalizeVersion(match);
	
	if (normalizedMatch !== version) {
		console.log(`❌ Package versions do not match: ${normalizeVersion(match)} !== ${version}`);
		process.exit(1);
	}
}

console.log(`✅ All packages have the same version: ${version}`);
console.log(`   Packages: ${packageList.join(", ")}`);