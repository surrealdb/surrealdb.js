import dedent from "dedent";
import { rolldown } from "rolldown";

const [, , ...flags] = Bun.argv;

// Build the NAPI binary
console.log("🔨 Building the NAPI binary");

const DTS_HEADER = dedent`
	type CapabilitiesAllowDenyList = {
		allow?: boolean | string[];
		deny?: boolean | string[];
	};

	type ConnectionOptions = {
		strict?: boolean;
		query_timeout?: number;
		transaction_timeout?: number;
		capabilities?:
			| boolean
			| {
				scripting?: boolean;
				guest_access?: boolean;
				live_query_notifications?: boolean;
				functions?: boolean | string[] | CapabilitiesAllowDenyList;
				network_targets?: boolean | string[] | CapabilitiesAllowDenyList;
				experimental?: boolean | string[] | CapabilitiesAllowDenyList;
			};
	};
	\n
`;

const buildCmd = [
    "bunx",
    "napi",
    "build",
    "-s",
    "--esm",
    "--dts-header",
    DTS_HEADER,
    "--platform",
    "--release",
    "--features",
    "kv-rocksdb,kv-mem,kv-surrealkv",
    "-o",
    "napi",
];

if (flags.length > 0) {
    buildCmd.push(...flags);
    console.log(`🎯 NAPI flags: ${flags.join(" ")}`);
}

await Bun.spawn(buildCmd, {
    stdout: "inherit",
    stderr: "inherit",
}).exited;

// Bundle the engine implementation
console.log("🔨 Generating the package bundle");

const bundle = await rolldown({
    input: "./src-ts/index.ts",
    external: ["surrealdb", "node:module"],
});

// ESModule only (we require top level await)
await bundle.write({
    format: "esm",
    file: "./dist/surrealdb-node.mjs",
});

// TS Declaration
const task = Bun.spawn(
    [
        "bunx",
        "dts-bundle-generator",
        "--project",
        "tsconfig.types.json",
        "--no-check",
        "--disable-symlinks-following",
        "--export-referenced-types",
        "false",
        "-o",
        "./dist/surrealdb-node.d.ts",
        "./src-ts/index.ts",
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
