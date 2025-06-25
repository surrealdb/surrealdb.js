import { parseArgs } from "node:util";
import { createLogger } from "../utils/logger";
import {
	PACKAGES,
	readPackageJson,
	resolvePackage,
} from "../utils/package";
import { publishJSR, publishNPM } from "./publish";
import { extractVersionChannel } from "./channel";

const logger = createLogger("publish");

const { positionals, values } = parseArgs({
	args: Bun.argv.slice(2),
	allowPositionals: true,
	options: {
		"dry-run": {
			type: "boolean",
		},
	},
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
		logger.error(
			`Invalid target specified. Available targets are: ${PACKAGES.join(", ")}`,
		);
		process.exit(1);
	}

	await publishPackage(target);
}

async function publishPackage(name: string): Promise<void> {
	const pkg = resolvePackage(name);
	const { version } = await readPackageJson(pkg);
	const channel = extractVersionChannel(version);

	// JSR
	try {
		await publishJSR(pkg, dryrun);

		if (dryrun) {
			logger.success(`Verified JSR publish workflow for ${name}`);
		} else {
			logger.success(`Successfully published ${name} to JSR`);
		}
	} catch (error) {
		logger.error(`Failed to publish JSR for ${name}: ${error}`);
	}

	// NPM
	try {
		await publishNPM(pkg, dryrun, channel);

		if (dryrun) {
			logger.success(`Verified NPM publish workflow for ${name} (${channel})`);
		} else {
			logger.success(`Successfully published ${name} to NPM (${channel})`);
		}
	} catch (error) {
		logger.error(`Failed to publish NPM for ${name}: ${error}`);
	}
}
