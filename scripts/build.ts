import * as esbuild from "esbuild";
import tscPlugin from "esbuild-plugin-tsc";

await Promise.all([
	esbuild.build({
		entryPoints: ["src/index.ts"],
		bundle: true,
		outfile: "dist/index.mjs",
		plugins: [tscPlugin({ force: true })],
		external: ["uuidv7", "isows"],
		format: "esm",
		minifyWhitespace: true,
		minifySyntax: true,
	}),
	esbuild.build({
		entryPoints: ["src/index.ts"],
		bundle: true,
		outfile: "dist/index.cjs",
		plugins: [tscPlugin({ force: true })],
		external: ["uuidv7", "isows"],
		format: "cjs",
		minifyWhitespace: true,
		minifySyntax: true,
	}),
	esbuild.build({
		entryPoints: ["src/index.ts"],
		bundle: true,
		outfile: "dist/index.bundled.mjs",
		plugins: [tscPlugin({ force: true })],
		format: "esm",
		minifyWhitespace: true,
		minifySyntax: true,
	}),
]);

Bun.spawn([
	"bunx",
	"dts-bundle-generator",
	"-o",
	"dist/index.d.ts",
	"src/index.ts",
	"--no-check",
	"--export-referenced-types",
	"false",
]);
