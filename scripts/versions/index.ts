import { createLogger } from "../utils/logger";
import { PACKAGES, readPackageJson, resolvePackage } from "../utils/package";

const logger = createLogger("versions");
const validate = Bun.argv[2]?.replace(/^v/, "");
let incompatible = false;

const { version: rootVersion } = await readPackageJson(".");

if (validate && validate !== rootVersion) {
	logger.error(`Repository version (${rootVersion}) does not match the validation version (${validate}).`);
	incompatible = true;
}

for (const pkg of PACKAGES) {
	const pkgDir = resolvePackage(pkg);
	const { version } = await readPackageJson(pkgDir);

	if (version !== rootVersion) {
		logger.error(`${pkg} version (${version}) does not match root version (${rootVersion}).`);
		incompatible = true;
		continue;
	}

	logger.info(`Compatible version found for ${pkg}`);
}

if (incompatible) {
	process.exit(1);
} else {
	logger.success("All packages are compatible");
}

