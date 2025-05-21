import { join } from "node:path";
import { readPackageJson } from "scripts/utils/package";

export async function generateJSR(pkg: string): Promise<void> {
	const { name, version } = await readPackageJson(pkg);

	const jsrJson = join(pkg, "jsr.json");
	const config = {
		name,
		version,
		exports: "./src/index.ts",
		publish: {
			include: ["src/**/*.ts"],
		},
	};

	await Bun.write(jsrJson, JSON.stringify(config, null, 2));
}
