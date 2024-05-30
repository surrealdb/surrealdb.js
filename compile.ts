import { build, emptyDir } from "@deno/dnt";
import project from "./deno.json" with { type: "json" };

await emptyDir("./npm");

await build({
	entryPoints: ["./src/index.ts"],
	outDir: "./npm",
	shims: {
		// see JS docs for overview and more options
		deno: false,
		webSocket: false,
	},
	package: {
		// package.json properties
		name: "surrealdb.js",
		version: project.version,
		description: "Javascript driver for SurrealDB",
		license: "Apache 2.0",
		repository: {
			type: "git",
			url: "https://github.com/surrealdb/surrealdb.js.git",
		},
		author: {
			name: "Tobie Morgan Hitchcock",
			url: "https://surrealdb.com",
		},
		dependencies: {
			"isows": "^1.0.4",
			"ws": "^8.16.0",
			"semver": "^7.5.4",
		},
		optionalDependencies: {
			"bufferutil": "^4.0.8",
			"utf-8-validate": "^6.0.3",
		},
		devDependencies: {
			"@types/node": "^18.7.18",
			"@types/ws": "8.5.3",
			"esbuild": "0.15.8",
			"@types/semver": "^7.5.8",
		},
		scripts: {
			"build:web":
				"esbuild ./esm/index.js --format=esm --minify --bundle --sourcemap --outfile=./web/index.js",
		},
		browser: "./web/index.js",
		engines: {
			node: ">=18.0.0",
		},
	},
	// skipSourceOutput: true,
	mappings: {
		"./src/library/WebSocket/deno.ts": "./src/library/WebSocket/node.ts",
	},
	compilerOptions: {
		lib: ["DOM", "ES2021.String"],
		sourceMap: true,
	},
});

// post build steps
Deno.copyFileSync("LICENSE", "npm/LICENSE");
Deno.copyFileSync("README.md", "npm/README.md");
Deno.copyFileSync(".npmrc", "npm/.npmrc");
