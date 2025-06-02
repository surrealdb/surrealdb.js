import { join } from "node:path";

export async function generateDeclarations(pkg: string): Promise<void> {
	const entryPoint = join(pkg, "src/index.ts");
	const dtsOutput = join(pkg, "dist/index.d.ts");

	const task = Bun.spawn(
		[
			"bunx",
			"dts-bundle-generator",
			"-o",
			dtsOutput,
			entryPoint,
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

	await task.exited;
}