import { rollup } from "rollup";
import typescript from "@rollup/plugin-typescript";
import fs from "fs";

const bundle = await rollup({
	input: "./src/index.ts",
	plugins: [typescript()],
});

console.log(bundle);

const { output } = await bundle.generate({
	dir: "./dist",
});

for (const f of output) {
	// console.log(f.fileName);
	if (f.type === "asset") {
		fs.writeFileSync(`./dist/${f.fileName}`, f.source);
	} else {
		fs.writeFileSync(`./dist/${f.fileName}`, f.code);
	}
}

// import dts from "bun-plugin-dts";

// const results = [
// 	// Node, deps externalized
// 	await Bun.build({
// 		entrypoints: ["./src/index.ts"],
// 		outdir: "./dist",
// 		target: "node",
// 		external: ["uuidv7", "isows"],
// 		plugins: [dts()],
// 		minify: true,
// 	}),

// 	// Web, deps bundled
// 	await Bun.build({
// 		entrypoints: ["./src/index.ts"],
// 		outdir: "./dist",
// 		target: "browser",
// 		naming: "[name].web.[ext]",
// 		minify: true,
// 	}),
// ];

// for (const result of results) {
// 	if (!result.success) {
// 		const logs = result.logs.join("\n");
// 		throw new Error(`Build failed, logs: ${logs}`);
// 	}
// }
