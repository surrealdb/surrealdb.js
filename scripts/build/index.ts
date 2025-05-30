import { createLogger } from "scripts/utils/logger";
import { PACKAGES, resolvePackage } from "scripts/utils/package";
import { generateJSR } from "./jsr";
import { compileDist } from "./esbuild";
import { generateDeclarations } from "./declarations";

const logger = createLogger("build");
const target = Bun.argv[2];

if (!target) {
	logger.error("No target specified. Please provide a target package.");
	process.exit(1);
}

if (target === "all") {
	for (const pkg of PACKAGES) {
		await buildPackage(pkg);
	}
} else {
	if (!PACKAGES.includes(target)) {
		logger.error(`Invalid target specified. Available targets are: ${PACKAGES.join(", ")}`);
		process.exit(1);
	}
	
	await buildPackage(target);
}

async function buildPackage(name: string): Promise<void> {
	const pkg = resolvePackage(name);

	await generateJSR(pkg);
	logger.success(`JSR file generated for ${name}.`);

	await compileDist(pkg);
	logger.success(`Compiled distribution files for ${name}.`);

	await generateDeclarations(pkg);
	logger.success(`Generated declaration files for ${name}.`);
}