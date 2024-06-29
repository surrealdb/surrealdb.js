import { version } from "../package.json";
import path from "node:path";

const config = {
	name: "@surrealdb/surrealdb",
	version,
	exports: "./src/index.ts",
	publish: {
		include: ["LICENSE", "README.md", "SECURITY.md", "src/**/*.ts"],
	},
};

const file = path.join(path.dirname(import.meta.dir), "jsr.json");
await Bun.write(file, JSON.stringify(config, null, 2));
