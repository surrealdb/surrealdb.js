import path from "node:path";
import { version } from "../package.json";

const config = {
	name: "@surrealdb/cbor",
	version,
	exports: "./src/index.ts",
	publish: {
		include: ["src/**/*.ts"],
	},
};

const file = path.join(path.dirname(import.meta.dir), "jsr.json");
await Bun.write(file, JSON.stringify(config, null, 2));
