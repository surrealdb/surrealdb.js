import { build, emptyDir } from "https://deno.land/x/dnt/mod.ts";
import project from "./project.json" assert { type: "json" };

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
			"isomorphic-ws": "^5.0.0",
			"ws": "^8.8.1",
		},
		devDependencies: {
			"@types/node": "^18.7.18",
			"@types/ws": "8.5.3",
      "esbuild": "0.15.8"
		},
    scripts: {
      "build:web": "esbuild ./esm/index.js --bundle --sourcemap --outfile=./web/index.js"
    }
	},
	// skipSourceOutput: true,
	mappings: {
		"./src/ws/deno.ts": "./src/ws/node.ts",
	},
	compilerOptions: {
		lib: ["dom"],
		sourceMap: true,
	},
});

// post build steps
Deno.copyFileSync("LICENSE", "npm/LICENSE");
Deno.copyFileSync("README.md", "npm/README.md");
