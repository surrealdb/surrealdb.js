# GitHub Workflows

This directory contains GitHub Actions workflows for the SurrealDB.js project.

## Workflows

### 1. CI Workflow (`check.yml`)
- **Trigger**: Push to main, pull requests
- **Purpose**: Code quality checks and testing
- **Jobs**:
  - Code quality checks with Biome
  - Integration tests against multiple SurrealDB versions
  - Tests with different engines (WebSocket, HTTP)

### 2. Publish Workflow (`publish.yml`)
- **Trigger**: GitHub releases, manual dispatch
- **Purpose**: Build and publish all packages to npm and JSR
- **Features**:
  - Manual dispatch with dry-run option
  - Version validation
  - Separate build jobs for each package
  - Multi-platform Node.js binary builds
  - WASM package compilation
  - NPM and JSR publishing

**Jobs:**
- `validate` - Validates package versions
- `build-sdk` - Builds the SDK package
- `build-wasm` - Builds the WASM package (depends on SDK)
- `build-node` - Builds Node.js binaries for all platforms (depends on SDK)
- `dry-run-publish` - Tests publishing without actually publishing
- `publish` - Actual publishing (only if not dry-run)
- `summary` - Provides publish status summary

### 3. Test Publish Workflow (`test-publish.yml`)
- **Trigger**: Manual dispatch only
- **Purpose**: Test the publish process without actually publishing
- **Jobs**:
  - `test-build-sdk` - Test SDK build process
  - `test-build-wasm` - Test WASM build process
  - `test-build-node` - Test Node.js build process
  - `test-publish-process` - Test complete publish process
  - `test-rust-setup` - Test Rust toolchain setup

## Usage

### Manual Publishing

1. **Dry Run Only**:
   ```bash
   # Go to Actions tab → Publish → Run workflow
   # Select "Dry run only: true"
   ```

2. **Full Publish**:
   ```bash
   # Go to Actions tab → Publish → Run workflow
   # Select "Dry run only: false"
   # Optionally specify a version
   ```

### Release Publishing

1. Create a GitHub release with a tag (e.g., `v1.0.0`)
2. The publish workflow will automatically trigger
3. All packages will be built and published

## Required Secrets

The following secrets must be configured in the repository settings:

- `NPM_TOKEN`: NPM authentication token
- `JSR_TOKEN`: JSR authentication token

## Package Publishing

The workflow publishes the following packages:

- **SDK** (`surrealdb`): Main SDK package
- **Node** (`@surrealdb/node`): Node.js native bindings
- **WASM** (`@surrealdb/wasm`): WebAssembly bindings

All packages are published to both NPM and JSR (where applicable).

## Build Process

1. **Validate Versions**: Ensures all packages have consistent versions
2. **Build SDK**: Uses `bun run build:sdk` to build the main SDK package
3. **Build WASM**: Uses `bun run build:wasm` after installing Rust toolchain
4. **Build Node**: Uses `bun run build:node` for multi-platform native binary compilation
5. **Dry Run Publish**: Test publishing without actually publishing
6. **Publish**: Actual publishing to NPM and JSR

### Build Dependencies

- **SDK**: No dependencies (builds first)
- **WASM**: Depends on SDK + Rust toolchain (wasm32-unknown-unknown, wasm-bindgen-cli, wasm-opt)
- **Node**: Depends on SDK + Rust toolchain (for native compilation)

## Platform Support

### Node.js Binaries
- macOS (x86_64, ARM64)
- Windows (x86_64)
- Linux (x86_64, ARM64, musl)
- Android (ARM64)

### WASM Package
- All platforms supporting WebAssembly
