import { build, emptyDir } from "https://deno.land/x/dnt@0.34.0/mod.ts";
import project from "./project.json" with { type: "json" };

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
		},
		optionalDependencies: {
			"bufferutil": "^4.0.8",
			"utf-8-validate": "^6.0.3",
		},
		devDependencies: {
			"@types/node": "^18.7.18",
			"@types/ws": "8.5.3",
			"esbuild": "0.15.8",
		},
		scripts: {
			"build:web":
				"esbuild ./esm/index.js --format=esm --minify --bundle --sourcemap --outfile=./web/index.js",
		},
		browser: "./web/index.js",
	},
	// skipSourceOutput: true,
	mappings: {
		"./src/library/WebSocket/deno.ts": "./src/library/WebSocket/node.ts",
	},
	compilerOptions: {
		lib: ["dom", "es2021.string"],
		sourceMap: true,
	},
});

// post build steps
Deno.copyFileSync("LICENSE", "npm/LICENSE");
Deno.copyFileSync("README.md", "npm/README.md");
