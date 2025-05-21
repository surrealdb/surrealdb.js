import { join } from "node:path";
import * as esbuild from "esbuild";
import tscPlugin from "esbuild-plugin-tsc";

export async function compileDist(pkg: string): Promise<void> {
	const entryPoint = join(pkg, "src/index.ts");
	const mjsOutput = join(pkg, "dist/index.mjs");
	const cjsOutput = join(pkg, "dist/index.cjs");

	await Promise.all([
		esbuild.build({
			entryPoints: [entryPoint],
			bundle: true,
			outfile: mjsOutput,
			plugins: [tscPlugin({ force: true })],
			format: "esm",
			minifyWhitespace: true,
			minifySyntax: true,
			sourcemap: true,
		}),
		esbuild.build({
			entryPoints: [entryPoint],
			bundle: true,
			outfile: cjsOutput,
			plugins: [tscPlugin({ force: true })],
			format: "cjs",
			minifyWhitespace: true,
			minifySyntax: true,
			sourcemap: true,
		}),
	]);
}
