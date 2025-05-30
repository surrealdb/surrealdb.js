import { join } from "node:path";

/** Ordered list of packages for the build process  */
export const PACKAGES: string[] = ["cbor", "sdk"];

export function resolvePackage(pkg: string): string {
	return join("packages", pkg);
}

export function readPackageJson(pkg: string): Promise<PackageJson> {
	return Bun.file(join(pkg, "package.json")).json();
}

export interface PackageJson {
	name: string;
	version: string;
}