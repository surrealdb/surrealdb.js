import { join } from "node:path";
import { readPackageJson } from "../utils/package";

const NS = "@surrealdb";

export async function generateJSR(pkg: string): Promise<void> {
	const { name, version } = await readPackageJson(pkg);

	const jsrJson = join(pkg, "jsr.json");
	const jsrName = name.startsWith(NS) ? name : `${NS}/${name}`;
	const config = {
		version,
		name: jsrName,
		exports: "./src/index.ts",
		publish: {
			include: ["src/**/*.ts"],
		},
	};

	await Bun.write(jsrJson, JSON.stringify(config, null, 2));
}
