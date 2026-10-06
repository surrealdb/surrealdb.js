// Learn more: https://docs.expo.dev/guides/monorepos/
const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

// Expo auto-detects the Bun workspace root, but we set these explicitly so the
// demo does not depend on that detection.

// 1. Watch the whole monorepo. Required because Metro resolves the
//    `node_modules/surrealdb` workspace symlink to its realpath
//    (<root>/packages/sdk/dist/*), which lives outside `projectRoot`.
config.watchFolders = [monorepoRoot];

// 2. Bun's default linker hoists to the root like npm/yarn, so Metro's
//    hierarchical lookup already finds everything. Listing both paths makes it
//    deterministic. Note we deliberately leave `disableHierarchicalLookup`
//    alone - that is a pnpm/isolated-store workaround and would break this
//    layout.
config.resolver.nodeModulesPaths = [
    path.resolve(projectRoot, "node_modules"),
    path.resolve(monorepoRoot, "node_modules"),
];

module.exports = config;
