#!/usr/bin/env bun

import { satisfies, valid } from "semver";
import { resolvePackages } from "./utils/package.js";

console.log("🔍 Validating package versions...");

const packages = await resolvePackages();

// Find specific packages
const wasmPackage = packages.get("@surrealdb/wasm");
const nodePackage = packages.get("@surrealdb/node");
const surrealdbPackage = packages.get("surrealdb");

if (!wasmPackage || !nodePackage || !surrealdbPackage) {
    console.log("❌ SDK packages not found");
    process.exit(1);
}

// Check that WASM and Node packages have the same version
if (wasmPackage.version !== nodePackage.version) {
    console.log("❌ @surrealdb/wasm and @surrealdb/node have different versions:");
    console.log(`   @surrealdb/wasm: ${wasmPackage.version}`);
    console.log(`   @surrealdb/node: ${nodePackage.version}`);
    process.exit(1);
}

console.log(`✅ @surrealdb/wasm and @surrealdb/node have the same version: ${wasmPackage.version}`);

const sdkVersion = surrealdbPackage.version;

function checkDependencies(list: Record<string, string>) {
    const range = list.surrealdb;
    surrealdbPackage;

    if (!range) {
        console.log("❌ SDK is not a dependency");
        process.exit(1);
    }

    if (!satisfies(sdkVersion, range)) {
        console.log(`❌ SDK version ${sdkVersion} does not satisfy ${range}`);
        process.exit(1);
    }
}

// The native engines determine which SurrealDB a user runs. They are peer
// dependencies so users can choose the engine version, and exact devDependencies
// so we test against a known one. The pin must satisfy the advertised range, and
// both packages must be tested against the same engine.
const engines = [
    [nodePackage, "@surrealdb/node-native"],
    [wasmPackage, "@surrealdb/wasm-native"],
] as const;

const pins: string[] = [];

for (const [pkg, engine] of engines) {
    const range = pkg.peerDependencies[engine];
    const pin = pkg.devDependencies[engine];

    if (!range) {
        console.log(`❌ ${pkg.name} must declare ${engine} as a peer dependency`);
        process.exit(1);
    }

    if (!pin || !valid(pin)) {
        console.log(`❌ ${pkg.name} must pin ${engine} to an exact devDependency, found: ${pin}`);
        process.exit(1);
    }

    if (!satisfies(pin, range, { includePrerelease: true })) {
        console.log(`❌ ${pkg.name}: tested ${engine}@${pin} does not satisfy peer range ${range}`);
        process.exit(1);
    }

    pins.push(pin);
}

if (pins[0] !== pins[1]) {
    console.log("❌ Node and WASM are tested against different engine versions:");
    console.log(`   @surrealdb/node-native: ${pins[0]}`);
    console.log(`   @surrealdb/wasm-native: ${pins[1]}`);
    process.exit(1);
}

console.log(`✅ Both packages are tested against SurrealDB engine ${pins[0]}`);

checkDependencies(nodePackage.peerDependencies);
checkDependencies(nodePackage.devDependencies);
checkDependencies(wasmPackage.peerDependencies);
checkDependencies(wasmPackage.devDependencies);

console.log("✅ Version ranges are valid");
