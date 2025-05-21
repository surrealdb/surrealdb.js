import { parseArgs } from "node:util";
import { createLogger } from "scripts/utils/logger";
import { PACKAGES, resolvePackage } from "scripts/utils/package";
import { publishJSR, publishNPM } from "./publish";

const logger = createLogger("publish");

const { positionals, values } = parseArgs({
	args: Bun.argv.slice(2),
	allowPositionals: true,
	options: {
		"dry-run": {
			type: "boolean"
		},
	}
});

const target = positionals[0];
const dryrun = values["dry-run"] ?? false;

if (!target) {
	logger.error("No target specified. Please provide a target package.");
	process.exit(1);
}

if (target === "all") {
	for (const pkg of PACKAGES) {
		await publishPackage(pkg);
	}
} else {
	if (!PACKAGES.includes(target)) {
		logger.error(`Invalid target specified. Available targets are: ${PACKAGES.join(", ")}`);
		process.exit(1);
	}
	
	await publishPackage(target);
}

async function publishPackage(name: string): Promise<void> {
	const pkg = resolvePackage(name);

	// Dry run to check if the package can be published
	await publishJSR(pkg, dryrun);
	
	if (dryrun) {
		logger.success(`Verified JSR publish workflow for ${name}`);
	} else {
		logger.success(`Successfully published ${name} to JSR`);
	}

	await publishNPM(pkg, dryrun);

	if (dryrun) {
		logger.success(`Verified NPM publish workflow for ${name}`);
	} else {
		logger.success(`Successfully published ${name} to NPM`);
	}
}