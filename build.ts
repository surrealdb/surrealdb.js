import dts from "bun-plugin-dts";

const results = [
    // Node, deps externalized
    await Bun.build({
        entrypoints: ["./src/index.ts"],
        outdir: "./dist",
        target: "node",
        external: ["uuidv7", "isows"],
        plugins: [dts()],
        minify: true,
    }),

    // Web, deps bundled
    await Bun.build({
        entrypoints: ["./src/index.ts"],
        outdir: "./dist",
        target: "browser",
        naming: "[name].web.[ext]",
        minify: true,
    }),
];

for (const result of results) {
    if (!result.success) {
        const logs = result.logs.join("\n");
        throw new Error(`Build failed, logs: ${logs}`);
    }
}
