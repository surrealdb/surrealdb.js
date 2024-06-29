import * as esbuild from "esbuild";
import tscPlugin from "esbuild-plugin-tsc";

await Promise.all([
	esbuild.build({
		entryPoints: ["src/index.ts"],
		bundle: true,
		outfile: "dist/esm.js",
		plugins: [tscPlugin({ force: true })],
		external: ["uuidv7", "isows"],
		format: "esm",
		minify: true,
	}),
	esbuild.build({
		entryPoints: ["src/index.ts"],
		bundle: true,
		outfile: "dist/cjs.js",
		plugins: [tscPlugin({ force: true })],
		external: ["uuidv7", "isows"],
		format: "cjs",
		minify: true,
	}),
	esbuild.build({
		entryPoints: ["src/index.ts"],
		bundle: true,
		outfile: "dist/esm.bundled.js",
		plugins: [tscPlugin({ force: true })],
		format: "esm",
		minify: true,
	}),
]);

Bun.spawn([
	"bunx",
	"dts-bundle-generator",
	"-o",
	"dist/types.d.ts",
	"src/index.ts",
	"--no-check",
	"--export-referenced-types",
	"false",
]);
