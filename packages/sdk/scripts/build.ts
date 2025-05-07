import * as esbuild from "esbuild";
import tscPlugin from "esbuild-plugin-tsc";

const shouldMinify = import.meta.env.NODE_ENV === "testing";

await Promise.all([
	esbuild.build({
		entryPoints: ["src/index.ts"],
		bundle: true,
		outfile: "dist/index.mjs",
		plugins: [tscPlugin({ force: true })],
		format: "esm",
		minifyWhitespace: true,
		minifySyntax: true,
		sourcemap: true,
	}),
	esbuild.build({
		entryPoints: ["src/index.ts"],
		bundle: true,
		outfile: "dist/index.cjs",
		plugins: [tscPlugin({ force: true })],
		format: "cjs",
		minifyWhitespace: true,
		minifySyntax: true,
		sourcemap: true,
	}),
]);

Bun.spawn(
	[
		"bunx",
		"dts-bundle-generator",
		"-o",
		"dist/index.d.ts",
		"src/index.ts",
		"--no-check",
		"--export-referenced-types",
		"false",
	],
	{
		stdout: "inherit",
		stderr: "inherit",
		async onExit(_, exitCode) {
			if (exitCode !== 0) process.exit(exitCode);
		},
	},
);
