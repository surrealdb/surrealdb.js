# surrealdb.js

The official SurrealDB library for JavaScript.

[![](https://img.shields.io/badge/status-beta-ff00bb.svg?style=flat-square)](https://github.com/surrealdb/surrealdb.js) [![](https://img.shields.io/badge/docs-view-44cc11.svg?style=flat-square)](https://surrealdb.com/docs/integration/libraries/javascript) [![](https://img.shields.io/badge/license-Apache_License_2.0-00bfff.svg?style=flat-square)](https://github.com/surrealdb/surrealdb.js)

## Contribution notes

### Local setup

This is a [Deno](https://deno.land) project, not NodeJS. For example, this means import paths include the `.ts` file extension. However, to also support other JavaScript environments, a build has been added to create a npm package that works for NodeJS, Bun, browsers with bundlers.

#### Supported environments
* [Deno](https://deno.land)
* [NodeJS](https://nodejs.org)
* [Bun](https://bun.sh)
* web-browsers

### Requirements

-   Deno
-   npm
-   NodeJS
-   Docker (for e2e tests)
-   Bun (for e2e tests)

### Build for all supported environments

For Deno, no build is needed. For all other environments run

`deno task build`.

### Formatting

`deno fmt`

### Linting

`deno lint`

### PRs

Before you commit, please format and lint your code accordingly to check for errors.

### Local setup

For local development the [Deno extension](https://marketplace.visualstudio.com/items?itemName=denoland.vscode-deno) for VSCode is helpful (hint: local Deno installation required).
